import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { exceptionDiagnostic, generateUuidV7 } from '@newtine/core';
import { BATCH_JOB, BATCH_JOB_NAME, type BatchJob } from './batch.job.js';
import type { BatchJobName } from './batch.role.js';

const BATCH_EVENTS: Record<
  BatchJobName,
  {
    started: string;
    completed: string;
    failed: string;
    startedMessage: string;
    completedMessage: string;
    failedMessage: string;
  }
> = {
  databaseCheck: {
    started: 'batch.started',
    completed: 'batch.completed',
    failed: 'batch.failed',
    startedMessage: 'Batch job started',
    completedMessage: 'Batch job completed',
    failedMessage: 'Batch job failed',
  },
  reportWorker: {
    started: 'batch.report_worker.started',
    completed: 'batch.report_worker.completed',
    failed: 'batch.report_worker.failed',
    startedMessage: 'Report worker started',
    completedMessage: 'Report worker completed',
    failedMessage: 'Report worker failed',
  },
  pipelineWorker: {
    started: 'batch.pipeline_worker.started',
    completed: 'batch.pipeline_worker.completed',
    failed: 'batch.pipeline_worker.failed',
    startedMessage: 'Pipeline worker started',
    completedMessage: 'Pipeline worker completed',
    failedMessage: 'Pipeline worker failed',
  },
  pipelineEmbeddingRepair: {
    started: 'batch.pipeline_embedding_repair.started',
    completed: 'batch.pipeline_embedding_repair.completed',
    failed: 'batch.pipeline_embedding_repair.failed',
    startedMessage: 'Pipeline embedding repair started',
    completedMessage: 'Pipeline embedding repair completed',
    failedMessage: 'Pipeline embedding repair failed',
  },
};

@Injectable()
export class BatchRunner {
  constructor(
    @Inject(BATCH_JOB) private readonly batchJob: BatchJob,
    private readonly logger: PinoLogger,
    @Inject(BATCH_JOB_NAME) private readonly configuredJobName: BatchJobName,
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
    if (jobName !== this.configuredJobName) {
      this.logger.error({ event: 'batch.unknown_job' }, 'Unknown batch job');
      return 1;
    }

    const events = BATCH_EVENTS[this.configuredJobName];
    const startedAt = process.hrtime.bigint();
    this.logger.info({ event: events.started }, events.startedMessage);

    try {
      await this.batchJob.run(processExecutionId, signal);
      this.logger.info(
        { event: events.completed, durationMs: elapsedMilliseconds(startedAt) },
        events.completedMessage,
      );
      return 0;
    } catch (exception: unknown) {
      this.logger.error(
        {
          event: events.failed,
          durationMs: elapsedMilliseconds(startedAt),
          diagnostic: exceptionDiagnostic(exception),
        },
        events.failedMessage,
      );
      return 1;
    }
  }
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
