import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { CoreModule, createLoggerOptions } from '@newtine/core';

import { DatabaseCheckJob } from '@newtine/batch/job/databaseCheck/databaseCheck.job.js';
import { BatchRunner } from '@newtine/batch/runner/batch.runner.js';

@Module({
  imports: [LoggerModule.forRoot(createLoggerOptions('batch')), CoreModule],
  providers: [DatabaseCheckJob, BatchRunner],
})
export class BatchModule {}
