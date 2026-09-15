import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import {
  CATEGORY_CODES,
  isCategoryCode,
  type CategoryCode,
} from '@newtine/core/common/category/category.catalog.js';

export type { UuidV7 };

export const PIPELINE_RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIALLY_SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

export const PIPELINE_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type PipelineJobStatus = (typeof PIPELINE_JOB_STATUSES)[number];

export const PIPELINE_JOB_STAGES = ['SEARCH', 'FETCH', 'GENERATE', 'VALIDATE'] as const;
export type PipelineJobStage = (typeof PIPELINE_JOB_STAGES)[number];

export const PIPELINE_RETRY_SCOPES = ['DISCOVERY', 'CONTENT'] as const;
export type PipelineRetryScope = (typeof PIPELINE_RETRY_SCOPES)[number];

export const PIPELINE_CATEGORY_CODES = CATEGORY_CODES;
export type PipelineCategoryCode = CategoryCode;

export function isPipelineCategoryCode(value: unknown): value is PipelineCategoryCode {
  return isCategoryCode(value);
}

export const PIPELINE_FAILURE_KINDS = [
  'INTERRUPTED',
  'INSUFFICIENT_EVIDENCE',
  'INVALID_OUTPUT',
  'SOURCE_UNAVAILABLE',
  'UPSTREAM_ERROR',
] as const;
export type PipelineFailureKind = (typeof PIPELINE_FAILURE_KINDS)[number];

export const CANDIDATE_DISPOSITIONS = ['DUPLICATE', 'NEW', 'UNCERTAIN'] as const;
export type CandidateDisposition = (typeof CANDIDATE_DISPOSITIONS)[number];

export interface PipelineLimits {
  discoveryQueries: number;
  discoveryNews: number;
  maxCandidates: number;
  maxNewIssues: number;
  issueSearchQueries: number;
  relatedArticlesPerQuery: number;
  maxBodyAttempts: number;
  validBodiesTarget: number;
  transientRetries: number;
}

export interface PipelineRunRequest {
  query: string;
  limits: PipelineLimits;
}

export interface DiscoveredArticle {
  id?: UuidV7;
  title: string;
  description: string;
  sourceUrl: string;
  naverUrl?: string;
  publisherName: string;
  publishedAt?: string;
}

export interface FetchedArticle {
  articleId: UuidV7;
  title: string;
  sourceUrl: string;
  publisherName: string;
  publishedAt?: string;
  body: string;
}

export interface ExistingIssueSummary {
  id: UuidV7;
  title: string;
  integratedSummary?: string;
  publicationStatus: 'UNPUBLISHED' | 'PUBLISHED' | 'WITHDRAWN';
}

export interface IssueCandidate {
  title: string;
  scope: string;
  confirmedFacts: string[];
  sourceArticleIds: UuidV7[];
  categoryCode: PipelineCategoryCode;
  /** Optional producer-owned classification used by the personalized feed. */
  mainTopic?: string;
  /** Optional producer-resolved entity from the canonical entities master. */
  representativeEntityId?: UuidV7;
  searchQueries?: string[];
}

export interface CandidateDecision {
  candidate: IssueCandidate;
  disposition: CandidateDisposition;
  existingIssueId?: UuidV7;
  reason: string;
}

export interface ViewpointContent {
  statement: string;
  articleIds: UuidV7[];
}

export interface GlossaryContent {
  term: string;
  definition: string;
  articleIds: UuidV7[];
}

export interface ImpactContent {
  targetType: 'AGE_GROUP';
  targetValue: 'AGE_19_34' | 'AGE_35_49' | 'AGE_50_64' | 'AGE_65_PLUS';
  description: string;
  articleIds: UuidV7[];
}

export interface GeneratedIssueContent {
  integratedSummary: string;
  summaryLines: [string, string, string];
  viewpoints: ViewpointContent[] | null;
  glossary: GlossaryContent[];
  impacts: ImpactContent[];
}

export interface SemanticValidationResult {
  status: 'PASS' | 'FAIL' | 'UNCERTAIN';
  reason: string;
  independentEvidenceGroups: UuidV7[][];
  conflicts: string[];
}

export interface PipelineJobRecord {
  id: UuidV7;
  runId: UuidV7;
  issueId: UuidV7;
  status: PipelineJobStatus;
  stage: PipelineJobStage;
  failureKind?: PipelineFailureKind;
  lastError?: string;
  attempt: number;
}

export type PipelineEmbeddingTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED';

/**
 * Durable, privacy-safe embedding work item. The task keeps only the
 * published issue fields required to reconstruct the embedding input; it
 * never stores an article body, prompt, or provider response.
 */
export interface PipelineEmbeddingTask {
  id: UuidV7;
  issueId: UuidV7;
  runId: UuidV7;
  jobId: UuidV7;
  runAttempt: number;
  runExecutionId?: UuidV7;
  claimToken?: UuidV7;
  claimedByProcessExecutionId?: UuidV7;
  claimedAt?: string;
  inputHash: string;
  model: string;
  status: PipelineEmbeddingTaskStatus;
  attempts: number;
  title: string;
  integratedSummary: string;
  lastError?: string;
}

export type PipelineEmbeddingSaveResult = 'SAVED' | 'STALE';

export interface PipelineRunSnapshot {
  id: UuidV7;
  idempotencyKey: string;
  requestHash: string;
  request: PipelineRunRequest;
  status: PipelineRunStatus;
  attempt: number;
  retryScope?: PipelineRetryScope;
  retryJobIds: UuidV7[];
  executionId?: UuidV7;
  currentStage?: PipelineJobStage;
  candidateCounts: {
    discovered: number;
    duplicate: number;
    uncertain: number;
    created: number;
    skippedByLimit: number;
  };
  jobs: PipelineJobRecord[];
  lastError?: string;
  embeddingPendingCount: number;
  usageSummary: PipelineUsageSummary;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRunWork extends PipelineRunSnapshot {
  executionId: UuidV7;
}

export interface DiscoveryOutcome {
  discovered: number;
  duplicate: number;
  uncertain: number;
  created: number;
  skippedByLimit: number;
}

export interface UsageRecordInput {
  runId: UuidV7;
  runAttempt: number;
  jobId?: UuidV7;
  operation: 'SEARCH' | 'FETCH' | 'EMBED' | 'LLM';
  purpose: string;
  promptVersion?: string;
  promptHash?: string;
  provider: string;
  model?: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  actualCost?: number;
  errorCode?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ProviderUsageMetadata {
  model?: string;
  promptVersion?: string;
  promptHash?: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderResult<T> {
  value: T;
  usage?: ProviderUsageMetadata;
}

export type ProviderOutput<T> = T | ProviderResult<T>;

export interface PipelineUsageSummary {
  calls: number;
  succeededCalls: number;
  failedCalls: number;
  unknownCalls: number;
  inputTokens: number;
  outputTokens: number;
  actualCost: number | null;
}
