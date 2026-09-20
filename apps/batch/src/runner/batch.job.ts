import type { UuidV7 } from '@newtine/core';

export const BATCH_JOB = Symbol('BATCH_JOB');
export const BATCH_JOB_NAME = Symbol('BATCH_JOB_NAME');

export interface BatchJob {
  run(processExecutionId?: UuidV7, signal?: AbortSignal): Promise<void>;
}
