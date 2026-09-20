import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { CoreModule, createLoggerOptions } from '@newtine/core';
import { BATCH_JOB } from '@newtine/batch/runner/batch.job.js';
import { DatabaseCheckBatchJob } from './databaseCheck.batch.job.js';
import { DatabaseCheckJob } from './databaseCheck.job.js';

@Module({
  imports: [LoggerModule.forRoot(createLoggerOptions('batch')), CoreModule],
  providers: [
    DatabaseCheckJob,
    DatabaseCheckBatchJob,
    { provide: BATCH_JOB, useExisting: DatabaseCheckBatchJob },
  ],
  exports: [BATCH_JOB, LoggerModule],
})
export class DatabaseCheckBatchModule {}
