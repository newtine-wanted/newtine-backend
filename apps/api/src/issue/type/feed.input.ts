import type { FeedOwner } from '@newtine/core';

export type FeedOwnerInput = FeedOwner;

export interface FeedBatchInput {
  owner: FeedOwnerInput;
  sessionId: string;
  batchNo: number;
}
