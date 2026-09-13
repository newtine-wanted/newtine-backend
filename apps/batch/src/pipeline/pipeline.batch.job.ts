import { Injectable } from '@nestjs/common';

import type { UuidV7 } from '@newtine/core';
import { PipelineWorker } from '@newtine/batch/pipeline/pipeline.worker.js';

@Injectable()
export class PipelineBatchJob {
  constructor(private readonly worker: PipelineWorker) {}

  async run(processExecutionId?: UuidV7): Promise<void> {
    const once = process.env.PIPELINE_WORKER_ONCE === '1';
    if (once) {
      await this.worker.runOnce(undefined, processExecutionId);
      return;
    }
    await this.worker.runForever(resolvePollInterval(), undefined, processExecutionId);
  }
}

function resolvePollInterval(): number {
  const value = Number(process.env.PIPELINE_WORKER_POLL_MS ?? 1_000);
  return Number.isSafeInteger(value) && value >= 100 ? value : 1_000;
}
