import { Injectable } from '@nestjs/common';

import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import { ReportAiConfiguration } from './report.ai.config.js';
import { ReportWorker } from './report.worker.js';

@Injectable()
export class ReportBatchJob {
  constructor(
    private readonly worker: ReportWorker,
    private readonly configuration: ReportAiConfiguration,
  ) {}

  async run(processExecutionId?: UuidV7, signal?: AbortSignal): Promise<void> {
    // Validate credentials/model before the first poll, including an empty
    // queue.  This makes a selected report worker fail fast and keeps report
    // settings out of unrelated batch jobs.
    this.configuration.assertReady();
    if (signal?.aborted) return;
    await this.worker.run(processExecutionId, signal);
  }
}
