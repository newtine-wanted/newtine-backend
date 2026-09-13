export { CoreModule } from './core.module.js';
export { Entity } from './common/entity/base.entity.js';
export { DomainException } from './common/exception/domain.exception.js';
export { ErrorCode } from './common/exception/error.code.js';
export type { ErrorCodeValue } from './common/exception/error.code.js';
export { IssueException, IssueExceptionCode } from './issue/domain/issue.exception.js';
export type { IssueExceptionCodeValue } from './issue/domain/issue.exception.js';
export { generateUuidV7, isUuidV7 } from './common/id/uuidV7.generator.js';
export type { UuidV7 } from './common/id/uuidV7.generator.js';
export { createDatabaseOptions } from './common/database/database.options.js';
export { LoggingConfigurationException } from './common/logging/logging.exception.js';
export {
  createLoggerOptions,
  DEFAULT_HTTP_SLOW_THRESHOLD_MS,
  loggingRedactPaths,
  resolveHttpSlowThreshold,
  resolveLogLevel,
} from './common/logging/logging.options.js';
export { exceptionDiagnostic } from './common/logging/exceptionDiagnostic.js';
export type { LogLevel, LogService } from './common/logging/logging.options.js';
export { MikroOrmTransactionManager } from './common/transaction/mikroOrm/mikroOrm.transactionManager.js';
export { NestedTransactionException } from './common/transaction/transaction.exception.js';
export { TRANSACTION_MANAGER } from './common/transaction/transaction.manager.js';
export type { TransactionManager } from './common/transaction/transaction.manager.js';
export { PipelineRunService } from './pipeline/application/pipeline.run.service.js';
export {
  DEFAULT_PIPELINE_LIMITS,
  normalizePipelineLimits,
} from './pipeline/domain/pipeline.limits.js';
export {
  PipelineException,
  PipelineExceptionCode,
  pipelineExternalException,
} from './pipeline/domain/pipeline.exception.js';
export type {
  PipelineExceptionOptions,
  PipelineExternalExceptionCode,
} from './pipeline/domain/pipeline.exception.js';
export {
  validateGeneratedContent,
  validateSemanticResult,
} from './pipeline/domain/pipeline.validator.js';
export type {
  CandidateDecision,
  CandidateDisposition,
  DiscoveredArticle,
  DiscoveryOutcome,
  ExistingIssueSummary,
  FetchedArticle,
  GeneratedIssueContent,
  GlossaryContent,
  ImpactContent,
  IssueCandidate,
  PipelineFailureKind,
  PipelineCategoryCode,
  PipelineEmbeddingTask,
  PipelineEmbeddingSaveResult,
  PipelineEmbeddingTaskStatus,
  PipelineJobRecord,
  PipelineJobStage,
  PipelineJobStatus,
  PipelineLimits,
  PipelineRetryScope,
  PipelineRunRequest,
  PipelineRunSnapshot,
  PipelineRunStatus,
  PipelineRunWork,
  PipelineUsageSummary,
  ProviderOutput,
  ProviderResult,
  ProviderUsageMetadata,
  SemanticValidationResult,
  UsageRecordInput,
  ViewpointContent,
} from './pipeline/domain/pipeline.types.js';
export {
  PIPELINE_CATEGORY_CODES,
  isPipelineCategoryCode,
} from './pipeline/domain/pipeline.types.js';
export { PIPELINE_RUN_REPOSITORY } from './pipeline/repository/pipeline.repository.js';
export { normalizePipelineArticleUrl } from './pipeline/domain/pipeline.url.js';
export type {
  InterruptPipelineRunInput,
  PipelineRunRepository,
  RegisterIssueResult,
} from './pipeline/repository/pipeline.repository.js';
export { InMemoryPipelineRepository } from './pipeline/repository/inMemoryPipeline.repository.js';
export { MikroOrmPipelineRepository } from './pipeline/repository/mikroOrmPipeline.repository.js';
export {
  ARTICLE_BODY_PROVIDER,
  CANDIDATE_CLASSIFIER,
  CONTENT_GENERATOR,
  EMBEDDING_PROVIDER,
  NEWS_SEARCH_PROVIDER,
  SEMANTIC_VALIDATOR,
} from './pipeline/domain/pipeline.ports.js';
export type {
  ArticleBodyProvider,
  CandidateClassifier,
  ContentGenerator,
  EmbeddingProvider,
  NewsSearchProvider,
  SemanticValidator,
} from './pipeline/domain/pipeline.ports.js';
