export interface FeedOwnerInput {
  userId: string;
}

export interface FeedBatchInput {
  owner: FeedOwnerInput;
  sessionId: string;
  batchNo: number;
}
