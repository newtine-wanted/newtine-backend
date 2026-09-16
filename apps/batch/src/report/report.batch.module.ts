import { Module } from '@nestjs/common';

import { CoreModule } from '@newtine/core';
import { REPORT_CONTENT_PROVIDER } from '@newtine/core/report/report.content.js';
import { ReportAiConfiguration } from './report.ai.config.js';
import { ReportBatchJob } from './report.batch.job.js';
import { ReportOpenAiProvider, ReportOpenAiResponsesClient } from './report.provider.js';
import { ReportWorker } from './report.worker.js';

@Module({
  imports: [CoreModule],
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
  ],
  exports: [ReportBatchJob],
})
export class ReportBatchModule {}
