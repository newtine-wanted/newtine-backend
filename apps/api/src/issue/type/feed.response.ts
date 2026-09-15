import { tags } from 'typia';
import type { IssueSelectionType, FeedContinuation } from '@newtine/core';

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

export interface FeedResponse {
  items: FeedCardResponse[];
  nextCursor: string | null;
  continuation: FeedContinuation;
}
