import { tags } from 'typia';

import type { CategoryCode, InterestAnalysisResult, LikedIssuesResult } from '@newtine/core';

export interface InterestAnalysisResponse {
  asOf: string & tags.Format<'date-time'>;
  period: {
    type: 'ROLLING_DAYS';
    days: number;
    startAt: string & tags.Format<'date-time'>;
    endAt: string & tags.Format<'date-time'>;
    timeZone: 'Asia/Seoul';
  };
  sampleStatus: 'EMPTY' | 'LOW_SAMPLE' | 'READY';
  minimumSampleSize: number;
  issueCount: number;
  likedIssueCount: number;
  categoryCounts: Array<{
    code: CategoryCode;
    name: string;
    count: number;
  }>;
}

export interface LikedIssuesResponse {
  items: Array<{
    issueId: string & tags.Format<'uuid'>;
    title: string;
    category: {
      code: CategoryCode;
      name: string;
    };
    likedAt: string & tags.Format<'date-time'>;
    thumbnailUrl: null;
  }>;
  totalCount: number;
  nextCursor: string | null;
}

export function toInterestAnalysisResponse(
  result: InterestAnalysisResult,
): InterestAnalysisResponse {
  return {
    asOf: result.asOf.toISOString(),
    period: {
      type: result.period.type,
      days: result.period.days,
      startAt: result.period.startAt.toISOString(),
      endAt: result.period.endAt.toISOString(),
      timeZone: result.period.timeZone,
    },
    sampleStatus: result.sampleStatus,
    minimumSampleSize: result.minimumSampleSize,
    issueCount: result.issueCount,
    likedIssueCount: result.likedIssueCount,
    categoryCounts: result.categoryCounts.map((category) => ({
      code: category.categoryCode,
      name: category.displayName,
      count: category.count,
    })),
  };
}

export function toLikedIssuesResponse(
  result: LikedIssuesResult,
  encodeCursor: (cursor: NonNullable<LikedIssuesResult['nextCursor']>) => string,
): LikedIssuesResponse {
  return {
    items: result.items.map((item) => ({
      issueId: item.issueId as LikedIssuesResponse['items'][number]['issueId'],
      title: item.title,
      category: {
        code: item.categoryCode,
        name: item.categoryDisplayName,
      },
      likedAt: item.likedAt.toISOString(),
      thumbnailUrl: null,
    })),
    totalCount: result.totalCount,
    nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
  };
}
