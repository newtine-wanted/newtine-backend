import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { CoreModule, createLoggerOptions } from '@newtine/core';
import { BATCH_JOB } from '@newtine/batch/runner/batch.job.js';
import { REPORT_CONTENT_PROVIDER } from '@newtine/core/report/report.content.js';
import { ReportAiConfiguration } from './report.ai.config.js';
import { ReportBatchJob } from './report.batch.job.js';
import { ReportOpenAiProvider, ReportOpenAiResponsesClient } from './report.provider.js';
import { ReportWorker } from './report.worker.js';

@Module({
  imports: [LoggerModule.forRoot(createLoggerOptions('batch')), CoreModule],
  providers: [
    {
      provide: ReportAiConfiguration,
      useFactory: () => new ReportAiConfiguration(),
    },
    ReportOpenAiResponsesClient,
    ReportOpenAiProvider,
    { provide: REPORT_CONTENT_PROVIDER, useExisting: ReportOpenAiProvider },
    ReportWorker,
    ReportBatchJob,
    { provide: BATCH_JOB, useExisting: ReportBatchJob },
  ],
  exports: [BATCH_JOB, LoggerModule],
})
export class ReportBatchModule {}
