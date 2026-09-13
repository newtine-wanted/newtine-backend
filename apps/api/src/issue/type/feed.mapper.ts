import type { FeedBatchResult, FeedCardResult, FeedSessionResult } from './feed.output.js';
import type { FeedBatchResponse, FeedCardResponse, FeedSessionResponse } from './feed.response.js';

export function toFeedSessionResponse(result: FeedSessionResult): FeedSessionResponse {
  return {
    sessionId: result.sessionId as FeedSessionResponse['sessionId'],
    guestKey: result.guestKey,
    expiresAt: result.expiresAt.toISOString() as FeedSessionResponse['expiresAt'],
    nextBatchNo: result.nextBatchNo,
  };
}

export function toFeedBatchResponse(result: FeedBatchResult): FeedBatchResponse {
  return {
    sessionId: result.sessionId as FeedBatchResponse['sessionId'],
    batchNo: result.batchNo,
    items: result.items.map(toFeedCardResponse),
    nextBatchNo: result.nextBatchNo,
    continuation: result.continuation,
  };
}

function toFeedCardResponse(item: FeedCardResult): FeedCardResponse {
  return {
    issueId: item.issueId as FeedCardResponse['issueId'],
    title: item.title,
    category: item.category,
    eventAt:
      item.eventAt === null ? null : (item.eventAt.toISOString() as FeedCardResponse['eventAt']),
    publishedAt:
      item.publishedAt === null
        ? null
        : (item.publishedAt.toISOString() as FeedCardResponse['publishedAt']),
    integratedSummary: item.integratedSummary,
    summaryLines: item.summaryLines,
    articleCount: item.articleCount,
    selectionType: item.selectionType,
    reasonCodes: item.reasonCodes,
  };
}
