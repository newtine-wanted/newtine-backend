import type { CategoryCode } from '@newtine/core/common/category/category.catalog.js';
import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

export type InterestEventType = 'LIKE' | 'SKIP' | 'PASS';

export interface InterestAnalysisPeriod {
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface InterestCategoryCount {
  readonly categoryCode: CategoryCode;
  readonly displayName: string;
  readonly count: number;
}

/** Raw aggregate returned by the persistence adapter before response metadata is added. */
export interface InterestAnalysisSnapshot {
  readonly issueCount: number;
  readonly likedIssueCount: number;
  readonly categoryCounts: readonly InterestCategoryCount[];
}

export interface InterestAnalysisResult extends InterestAnalysisSnapshot {
  readonly asOf: Date;
  readonly period: {
    readonly type: 'ROLLING_DAYS';
    readonly days: number;
    readonly startAt: Date;
    readonly endAt: Date;
    readonly timeZone: 'Asia/Seoul';
  };
  readonly sampleStatus: 'EMPTY' | 'LOW_SAMPLE' | 'READY';
  readonly minimumSampleSize: number;
}

export interface InterestCursor {
  readonly likedAt: Date;
  readonly issueId: UuidV7;
  readonly categoryCode?: CategoryCode;
}

export interface LikedIssuesQuery {
  readonly asOf: Date;
  readonly categoryCode?: CategoryCode;
  readonly cursor?: InterestCursor;
  readonly limit: number;
}

export interface LikedIssue {
  readonly issueId: UuidV7;
  readonly title: string;
  readonly categoryCode: CategoryCode;
  readonly categoryDisplayName: string;
  readonly likedAt: Date;
}

export interface LikedIssuesResult {
  readonly items: readonly LikedIssue[];
  readonly totalCount: number;
  readonly nextCursor: InterestCursor | null;
}

export interface InterestRepository {
  getInterestAnalysis(
    userId: UuidV7,
    period: InterestAnalysisPeriod,
  ): Promise<InterestAnalysisSnapshot>;
  getLikedIssues(userId: UuidV7, query: LikedIssuesQuery): Promise<LikedIssuesResult>;
}

export const INTEREST_REPOSITORY = Symbol('INTEREST_REPOSITORY');
