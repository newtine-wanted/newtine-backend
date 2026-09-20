import { Injectable } from '@nestjs/common';

import { isUuidV7, type UuidV7 } from '@newtine/core';
import { PipelineEmbeddingRepairJob } from './pipeline.embeddingRepair.job.js';

@Injectable()
export class PipelineEmbeddingRepairBatchJob {
  constructor(private readonly job: PipelineEmbeddingRepairJob) {}

  async run(processExecutionId?: UuidV7, signal?: AbortSignal): Promise<void> {
    await this.job.run(processExecutionId, resolveReclaimProcessExecutionId(), signal);
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
