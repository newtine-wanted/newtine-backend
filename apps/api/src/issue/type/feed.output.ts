import type { FeedContinuation, IssueSelectionType } from '@newtine/core';

export interface FeedSessionResult {
  sessionId: string;
  expiresAt: Date;
  nextBatchNo: number;
}

export interface FeedCardResult {
  issueId: string;
  title: string;
  category: { code: string; name: string };
  eventAt: Date | null;
  publishedAt: Date | null;
  integratedSummary: string;
  summaryLines: [string, string, string];
  articleCount: number;
  selectionType: IssueSelectionType;
  reasonCodes: string[];
}

export interface FeedBatchResult {
  sessionId: string;
  batchNo: number;
  items: FeedCardResult[];
  nextBatchNo: number | null;
  continuation: FeedContinuation;
}

export interface FeedPageResult extends FeedBatchResult {
  expiresAt: Date;
}
