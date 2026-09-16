import { ReportBatchJob } from '@newtine/batch/report/report.batch.job.js';
import { Injectable, Optional } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { exceptionDiagnostic, generateUuidV7, isUuidV7, type UuidV7 } from '@newtine/core';
import { DatabaseCheckJob } from '@newtine/batch/job/databaseCheck/databaseCheck.job.js';
import { PipelineBatchJob } from '@newtine/batch/pipeline/pipeline.batch.job.js';
import { PipelineEmbeddingRepairJob } from '@newtine/batch/pipeline/pipeline.embeddingRepair.job.js';

const REPORT_WORKER_JOB = 'reportWorker';
const DATABASE_CHECK_JOB = 'databaseCheck';
const PIPELINE_WORKER_JOB = 'pipelineWorker';
const PIPELINE_EMBEDDING_REPAIR_JOB = 'pipelineEmbeddingRepair';

@Injectable()
export class BatchRunner {
  constructor(
    private readonly databaseCheckJob: DatabaseCheckJob,
    private readonly logger: PinoLogger,
    @Optional() private readonly pipelineBatchJob?: PipelineBatchJob,
    @Optional() private readonly pipelineEmbeddingRepairJob?: PipelineEmbeddingRepairJob,
    @Optional() private readonly reportBatchJob?: ReportBatchJob,
  ) {
    this.logger.setContext(BatchRunner.name);
  }

  async run(jobName: string | undefined, signal?: AbortSignal): Promise<number> {
    const processExecutionId = generateUuidV7();
    const normalizedJobName = jobName ?? '(missing)';

    return this.logger.runInContext(
      () => this.runInContext(normalizedJobName, processExecutionId, signal),
      {
        bindings: { processExecutionId, jobName: normalizedJobName },
      },
    );
  }

  private async runInContext(
    jobName: string,
    processExecutionId: ReturnType<typeof generateUuidV7>,
    signal?: AbortSignal,
  ): Promise<number> {
    if (jobName !== DATABASE_CHECK_JOB) {
      if (jobName === REPORT_WORKER_JOB && this.reportBatchJob !== undefined) {
        return this.runReportWorker(processExecutionId, signal);
      }
      if (jobName === PIPELINE_WORKER_JOB && this.pipelineBatchJob !== undefined) {
        return this.runPipelineWorker(processExecutionId, signal);
      }
      if (
        jobName === PIPELINE_EMBEDDING_REPAIR_JOB &&
        this.pipelineEmbeddingRepairJob !== undefined
      ) {
        return this.runEmbeddingRepair(processExecutionId, signal);
      }
      this.logger.error({ event: 'batch.unknown_job' }, 'Unknown batch job');
      return 1;
    }

    const startedAt = process.hrtime.bigint();
    this.logger.info({ event: 'batch.started' }, 'Batch job started');

    try {
      await this.databaseCheckJob.run();
      this.logger.info(
        { event: 'batch.completed', durationMs: elapsedMilliseconds(startedAt) },
        'Batch job completed',
      );
      return 0;
    } catch (exception: unknown) {
      this.logger.error(
        {
          event: 'batch.failed',
          durationMs: elapsedMilliseconds(startedAt),
          diagnostic: exceptionDiagnostic(exception),
        },
        'Batch job failed',
      );
      return 1;
    }
  }

  private async runReportWorker(processExecutionId: UuidV7, signal?: AbortSignal): Promise<number> {
    const startedAt = process.hrtime.bigint();
    this.logger.info({ event: 'batch.report_worker.started' }, 'Report worker started');
    try {
      await this.reportBatchJob!.run(processExecutionId, signal);
      this.logger.info(
        { event: 'batch.report_worker.completed', durationMs: elapsedMilliseconds(startedAt) },
        'Report worker completed',
      );
      return 0;
    } catch (exception: unknown) {
      this.logger.error(
        {
          event: 'batch.report_worker.failed',
          durationMs: elapsedMilliseconds(startedAt),
          diagnostic: exceptionDiagnostic(exception),
        },
        'Report worker failed',
      );
      return 1;
    }
  }

  private async runPipelineWorker(
    processExecutionId: ReturnType<typeof generateUuidV7>,
    signal?: AbortSignal,
  ): Promise<number> {
    const startedAt = process.hrtime.bigint();
    this.logger.info({ event: 'batch.pipeline_worker.started' }, 'Pipeline worker started');
    try {
      await this.pipelineBatchJob!.run(processExecutionId, signal);
      this.logger.info(
        { event: 'batch.pipeline_worker.completed', durationMs: elapsedMilliseconds(startedAt) },
        'Pipeline worker completed',
      );
      return 0;
    } catch (exception: unknown) {
      this.logger.error(
        {
          event: 'batch.pipeline_worker.failed',
          durationMs: elapsedMilliseconds(startedAt),
          diagnostic: exceptionDiagnostic(exception),
        },
        'Pipeline worker failed',
      );
      return 1;
    }
  }

  private async runEmbeddingRepair(
    processExecutionId: ReturnType<typeof generateUuidV7>,
    signal?: AbortSignal,
  ): Promise<number> {
    const startedAt = process.hrtime.bigint();
    this.logger.info(
      { event: 'batch.pipeline_embedding_repair.started' },
      'Pipeline embedding repair started',
    );
    try {
      await this.pipelineEmbeddingRepairJob!.run(
        processExecutionId,
        resolveReclaimProcessExecutionId(),
        signal,
      );
      this.logger.info(
        {
          event: 'batch.pipeline_embedding_repair.completed',
          durationMs: elapsedMilliseconds(startedAt),
        },
        'Pipeline embedding repair completed',
      );
      return 0;
    } catch (exception: unknown) {
      this.logger.error(
        {
          event: 'batch.pipeline_embedding_repair.failed',
          durationMs: elapsedMilliseconds(startedAt),
          diagnostic: exceptionDiagnostic(exception),
        },
        'Pipeline embedding repair failed',
      );
      return 1;
    }
  }
}

function resolveReclaimProcessExecutionId(): UuidV7 | undefined {
  const value = process.env.PIPELINE_EMBEDDING_REPAIR_RECLAIM_OWNER?.trim();
  if (value === undefined || value.length === 0) return undefined;
  if (!isUuidV7(value)) {
    throw new Error(
      'PIPELINE_EMBEDDING_REPAIR_RECLAIM_OWNER must be a confirmed-dead processExecutionId (UUIDv7)',
    );
  }
  return value;
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
