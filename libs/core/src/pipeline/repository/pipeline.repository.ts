import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import type {
  CandidateDecision,
  DiscoveredArticle,
  DiscoveryOutcome,
  ExistingIssueSummary,
  FetchedArticle,
  GeneratedIssueContent,
  PipelineJobRecord,
  PipelineJobStage,
  PipelineEmbeddingTask,
  PipelineEmbeddingSaveResult,
  PipelineRunRequest,
  PipelineRunSnapshot,
  PipelineRunWork,
  SemanticValidationResult,
  UsageRecordInput,
} from '@newtine/core/pipeline/domain/pipeline.types.js';

export const PIPELINE_RUN_REPOSITORY = Symbol('PIPELINE_RUN_REPOSITORY');

export interface EnqueuePipelineRunInput {
  idempotencyKey: string;
  requestHash: string;
  request: PipelineRunRequest;
}

interface RetryPipelineRunInputBase {
  runId: UuidV7;
  expectedAttempt: number;
}

export type RetryPipelineRunInput =
  | (RetryPipelineRunInputBase & { scope: 'DISCOVERY'; failedJobIds?: UuidV7[] })
  | (RetryPipelineRunInputBase & { scope: 'CONTENT'; failedJobIds: UuidV7[] });

export interface InterruptPipelineRunInput {
  runId: UuidV7;
  expectedAttempt: number;
  executionId: UuidV7;
}

export interface RegisterIssueInput {
  runId: UuidV7;
  attempt: number;
  candidate: CandidateDecision;
  seedArticles: DiscoveredArticle[];
}

export type RegisterIssueResult =
  | { outcome: 'created'; job: PipelineJobRecord }
  | { outcome: 'duplicate' };

export interface PipelineRunRepository {
  enqueue(input: EnqueuePipelineRunInput): Promise<PipelineRunSnapshot>;
  findById(runId: UuidV7): Promise<PipelineRunSnapshot | null>;
  retry(input: RetryPipelineRunInput): Promise<PipelineRunSnapshot>;
  interrupt(input: InterruptPipelineRunInput): Promise<PipelineRunSnapshot>;
  claimNext(executionId: UuidV7): Promise<PipelineRunWork | null>;
  saveDiscoveredArticles(
    runId: UuidV7,
    articles: DiscoveredArticle[],
  ): Promise<DiscoveredArticle[]>;
  loadExistingIssues(query: string): Promise<ExistingIssueSummary[]>;
  loadIssue(issueId: UuidV7): Promise<ExistingIssueSummary | null>;
  loadSeedArticles(issueId: UuidV7): Promise<DiscoveredArticle[]>;
  registerIssue(input: RegisterIssueInput): Promise<RegisterIssueResult>;
  completeDiscovery(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    outcome: DiscoveryOutcome,
  ): Promise<void>;
  failRun(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    failureKind: string,
    message: string,
  ): Promise<void>;
  listJobs(runId: UuidV7, attempt: number): Promise<PipelineJobRecord[]>;
  claimJob(jobId: UuidV7, attempt: number, executionId: UuidV7): Promise<PipelineJobRecord | null>;
  updateRunStage(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    stage: PipelineJobStage,
  ): Promise<void>;
  updateJobStage(
    jobId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    stage: PipelineJobStage,
  ): Promise<void>;
  saveJobSuccess(
    jobId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    content: GeneratedIssueContent,
    validation: SemanticValidationResult,
    evidence: FetchedArticle[],
    embeddingModel?: string,
  ): Promise<boolean>;
  saveJobFailure(
    jobId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    failureKind: PipelineJobRecord['failureKind'],
    message: string,
  ): Promise<void>;
  completeRun(runId: UuidV7, attempt: number, executionId: UuidV7): Promise<void>;
  recordUsage(input: UsageRecordInput): Promise<void>;
  /** Complete an unclaimed primary result or a token-fenced repair result; stale writes are no-ops. */
  saveEmbedding(
    issueId: UuidV7,
    title: string,
    integratedSummary: string,
    embedding: number[],
    model: string,
    taskId?: UuidV7,
    claimToken?: UuidV7,
    expectedModel?: string,
  ): Promise<PipelineEmbeddingSaveResult>;
  markEmbeddingPending(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    jobId: UuidV7,
    message?: string,
  ): Promise<void>;
  claimPendingEmbeddingTasks(
    limit: number,
    processExecutionId: UuidV7,
    claimToken: UuidV7,
  ): Promise<PipelineEmbeddingTask[]>;
  /** Diagnostic listing; repair execution must use the atomic claim method above. */
  listPendingEmbeddingTasks(limit: number): Promise<PipelineEmbeddingTask[]>;
  /** Return a currently-owned task to PENDING after a provider/application failure. */
  failEmbeddingTask(taskId: UuidV7, claimToken: UuidV7, message: string): Promise<boolean>;
  /** Release one currently-owned claim without classifying it as a provider failure. */
  releaseEmbeddingClaim(taskId: UuidV7, claimToken: UuidV7): Promise<boolean>;
  /** Release all claims held by the current process during graceful shutdown. */
  releaseEmbeddingClaims(processExecutionId: UuidV7): Promise<number>;
  /** Explicit recovery only after the supervisor confirms the prior process is dead. */
  requeueEmbeddingClaims(deadProcessExecutionId: UuidV7): Promise<number>;
}
