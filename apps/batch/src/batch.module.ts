import { DynamicModule, Module } from '@nestjs/common';

import { DatabaseCheckBatchModule } from '@newtine/batch/job/databaseCheck/databaseCheck.batch.module.js';
import { PipelineBatchModule } from '@newtine/batch/pipeline/pipeline.batch.module.js';
import { ReportBatchModule } from '@newtine/batch/report/report.batch.module.js';
import { BATCH_JOB_NAME } from '@newtine/batch/runner/batch.job.js';
import type { BatchJobName } from '@newtine/batch/runner/batch.role.js';
import { BatchRunner } from '@newtine/batch/runner/batch.runner.js';

@Module({})
export class BatchModule {
  static forRole(jobName: BatchJobName): DynamicModule {
    const roleModule =
      jobName === 'reportWorker'
        ? ReportBatchModule
        : jobName === 'databaseCheck'
          ? DatabaseCheckBatchModule
          : PipelineBatchModule.forJob(jobName);

    return {
      module: BatchModule,
      imports: [roleModule],
      providers: [BatchRunner, { provide: BATCH_JOB_NAME, useValue: jobName }],
    };
  }
}
