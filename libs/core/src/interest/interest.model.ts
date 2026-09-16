import type { CategoryCode } from '@newtine/core/common/category/category.catalog.js';
import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

export type InterestEventType = 'LIKE' | 'SKIP' | 'PASS';

export interface RecordInteractionCommand {
  readonly eventId: UuidV7;
  readonly userId: UuidV7;
  readonly issueId: UuidV7;
  readonly sessionId: UuidV7;
  readonly action: InterestEventType;
}

export interface InteractionAcceptance {
  readonly eventId: UuidV7;
  readonly issueId: UuidV7;
  readonly acceptedAction: InterestEventType;
  readonly acceptedAt: Date;
}

export interface StartDetailViewCommand {
  readonly viewId: UuidV7;
  readonly userId: UuidV7;
  readonly issueId: UuidV7;
  readonly sessionId: UuidV7;
}

export interface DetailViewStarted {
  readonly viewId: UuidV7;
  readonly issueId: UuidV7;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly created: boolean;
}

export interface UpdateDetailViewCommand {
  readonly viewId: UuidV7;
  readonly userId: UuidV7;
  readonly issueId: UuidV7;
  readonly activeMilliseconds: number;
}

export interface DetailViewProgress {
  readonly viewId: UuidV7;
  readonly issueId: UuidV7;
  readonly acceptedActiveMilliseconds: number;
  readonly totalCreditedMilliseconds: number;
  readonly dwellScore: 0 | 0.5 | 1;
}

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

export interface InterestWriteRepository {
  recordInteraction(command: RecordInteractionCommand): Promise<InteractionAcceptance>;
  startDetailView(command: StartDetailViewCommand): Promise<DetailViewStarted>;
  updateDetailView(command: UpdateDetailViewCommand): Promise<DetailViewProgress>;
  findCurrentInteraction(userId: UuidV7, issueId: UuidV7): Promise<InterestEventType | null>;
}

export const INTEREST_REPOSITORY = Symbol('INTEREST_REPOSITORY');
export const INTEREST_WRITE_REPOSITORY = Symbol('INTEREST_WRITE_REPOSITORY');
