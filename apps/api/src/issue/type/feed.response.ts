import { tags } from 'typia';
import type { IssueSelectionType, FeedContinuation } from '@newtine/core';

export interface FeedSessionResponse {
  sessionId: string & tags.Format<'uuid'>;
  /** Bearer secret for guest batch requests; never returned for member sessions. */
  guestKey: string | null;
  expiresAt: string & tags.Format<'date-time'>;
  nextBatchNo: number & tags.Type<'uint32'>;
}

export interface FeedCardResponse {
  issueId: string & tags.Format<'uuid'>;
  title: string;
  category: { code: string; name: string };
  eventAt: (string & tags.Format<'date-time'>) | null;
  publishedAt: (string & tags.Format<'date-time'>) | null;
  integratedSummary: string;
  summaryLines: [string, string, string];
  articleCount: number & tags.Type<'uint32'>;
  selectionType: IssueSelectionType;
  reasonCodes: string[];
}

export interface FeedBatchResponse {
  sessionId: string & tags.Format<'uuid'>;
  batchNo: number & tags.Type<'uint32'>;
  items: FeedCardResponse[];
  nextBatchNo: (number & tags.Type<'uint32'>) | null;
  continuation: FeedContinuation;
}
