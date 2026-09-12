import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { exceptionDiagnostic, generateUuidV7 } from '@newtine/core';
import { DatabaseCheckJob } from '@newtine/batch/job/databaseCheck/databaseCheck.job.js';

const DATABASE_CHECK_JOB = 'databaseCheck';

@Injectable()
export class BatchRunner {
  constructor(
    private readonly databaseCheckJob: DatabaseCheckJob,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BatchRunner.name);
  }

  async run(jobName: string | undefined): Promise<number> {
    const executionId = generateUuidV7();
    const normalizedJobName = jobName ?? '(missing)';

    return this.logger.runInContext(() => this.runInContext(normalizedJobName), {
      bindings: { executionId, jobName: normalizedJobName },
    });
  }

  private async runInContext(jobName: string): Promise<number> {
    if (jobName !== DATABASE_CHECK_JOB) {
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
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
