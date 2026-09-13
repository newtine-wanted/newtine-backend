export interface FeedOwnerInput {
  userId: string | null;
  /** Raw guest bearer secret. It is required for batch access and generated on session creation. */
  guestKey: string | null;
}

export interface FeedBatchInput {
  owner: FeedOwnerInput;
  sessionId: string;
  batchNo: number;
}
