export type IssuePublicationStatus = 'UNPUBLISHED' | 'PUBLISHED' | 'WITHDRAWN';

export type IssueSelectionType =
  | 'PERSONALIZED'
  | 'MAJOR'
  | 'CONNECTED'
  | 'EXPLORATION'
  | 'OPPOSITE';

export type AgeGroup = 'AGE_19_34' | 'AGE_35_49' | 'AGE_50_64' | 'AGE_65_PLUS';

export interface IssueViewpointRecord {
  statement: string;
  articleIds: string[];
}

export interface IssueGlossaryRecord {
  term: string;
  definition: string;
  articleIds: string[];
}

export interface IssueArticleRecord {
  id: string;
  title: string;
  url: string;
  publisherName: string;
  publishedAt: Date | null;
}

export interface IssueImpactRecord {
  targetType: 'AGE_GROUP' | 'REGION';
  targetValue: string;
  description: string;
  timing: string | null;
  action: string | null;
}

export interface IssueRecord {
  id: string;
  title: string;
  categoryCode: string;
  categoryName: string;
  subCategory: string | null;
  mainTopic: string | null;
  representativeEntityId: string | null;
  entityIds: string[];
  regionCodes: string[];
  ageGroups: AgeGroup[];
  eventAt: Date | null;
  publicationStatus: IssuePublicationStatus;
  freshnessScore: number;
  importanceScore: number;
  publishedAt: Date | null;
  updatedAt: Date;
  integratedSummary: string | null;
  summaryLines: string[];
  viewpoints: IssueViewpointRecord[] | null;
  glossary: IssueGlossaryRecord[];
  articles: IssueArticleRecord[];
  articleCount: number;
  impacts: IssueImpactRecord[];
}

export interface UserRecommendationContext {
  userId: string;
  selectedCategoryCodes: string[];
  selectedEntityIds: string[];
  preferredRegionCodes: string[];
  ageGroup: AgeGroup | null;
}

export interface UserInteractionRecord {
  id: string;
  userId: string;
  issueId: string;
  eventType: 'LIKE' | 'SKIP' | 'PASS';
  createdAt: Date;
}

export interface IssueRelationRecord {
  fromIssueId: string;
  toIssueId: string;
  relationType: 'FOLLOW_UP';
  verifiedAt: Date;
}

/**
 * Signals used to build bounded per-selection candidate slices. The producer
 * remains the source of score values; this scope only widens the read pool so
 * a rare selection type is not hidden behind a global top-N query.
 */
export interface IssueCandidateScope {
  highScoreThreshold: number;
  selectedCategoryCodes: string[];
  selectedEntityIds: string[];
  preferredRegionCodes: string[];
  ageGroup: AgeGroup | null;
  actedCategoryCodes: string[];
  connectedIssueIds: string[];
}

export interface MemberFeedOwner {
  kind: 'MEMBER';
  userId: string;
}

export interface GuestFeedOwner {
  kind: 'GUEST';
  guestTokenHash: string;
}

export type FeedOwner = MemberFeedOwner | GuestFeedOwner;

export interface FeedSessionRecord {
  id: string;
  owner: FeedOwner;
  algorithmVersion: string;
  nextBatchNo: number;
  status: 'ACTIVE' | 'COMPLETED';
  createdAt: Date;
  expiresAt: Date;
  lastTopic: string | null;
  lastRepresentativeEntityId: string | null;
  topicRun: number;
  entityRun: number;
}

export interface FeedBatchItemRecord {
  issueId: string;
  position: number;
  selectionType: IssueSelectionType;
  reasonCodes: string[];
}

export type FeedContinuation = 'CONTINUE' | 'EXHAUSTED' | 'CONSTRAINT_LIMITED' | 'SEARCH_LIMITED';

export interface FeedBatchRecord {
  sessionId: string;
  batchNo: number;
  items: FeedBatchItemRecord[];
  continuation: FeedContinuation;
  createdAt: Date;
}

export interface IssueQueryRepository {
  createFeedSession(owner: FeedOwner, now: Date): Promise<FeedSessionRecord>;
  findFeedSession(id: string, owner: FeedOwner, now: Date): Promise<FeedSessionRecord | null>;
  findFeedBatch(sessionId: string, batchNo: number): Promise<FeedBatchRecord | null>;
  findFeedBatches(sessionId: string): Promise<FeedBatchRecord[]>;
  saveFeedBatch(session: FeedSessionRecord, batch: FeedBatchRecord): Promise<void>;
  findCandidates(
    excludedIssueIds: ReadonlySet<string>,
    limit?: number,
    scope?: IssueCandidateScope,
  ): Promise<IssueRecord[]>;
  findIssue(id: string): Promise<IssueRecord | null>;
  /** Loads the public issue fields needed to resolve a stored card batch. */
  readonly findIssuesByIds?: (ids: ReadonlySet<string>) => Promise<IssueRecord[]>;
  findUserContext(userId: string): Promise<UserRecommendationContext | null>;
  findLatestInteractions(userId: string): Promise<UserInteractionRecord[]>;
  findFollowUps(issueIds: ReadonlySet<string>): Promise<IssueRelationRecord[]>;
}

export const ISSUE_QUERY_REPOSITORY = Symbol('ISSUE_QUERY_REPOSITORY');
