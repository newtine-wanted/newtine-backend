import type { FeedPageResult, FeedCardResult } from './feed.output.js';
import type { FeedResponse, FeedCardResponse } from './feed.response.js';

export function toFeedResponse(result: FeedPageResult, nextCursor: string | null): FeedResponse {
  return {
    items: result.items.map(toFeedCardResponse),
    nextCursor,
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
