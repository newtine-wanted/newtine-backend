export { CoreModule } from './core.module.js';
export { Entity } from './common/entity/base.entity.js';
export {
  CATEGORY_CATALOG,
  CATEGORY_CODES,
  isCategoryCode,
} from './common/category/category.catalog.js';
export type { CategoryCatalogEntry, CategoryCode } from './common/category/category.catalog.js';
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
export type {
  AgeGroup as IssueAgeGroup,
  FeedBatchItemRecord,
  FeedBatchRecord,
  FeedContinuation,
  FeedOwner,
  FeedSessionRecord,
  IssueArticleRecord,
  IssueCandidateScope,
  IssueGlossaryRecord,
  IssueImpactRecord,
  IssueQueryRepository,
  IssueRecord,
  IssueRelationRecord,
  IssueSelectionType,
  IssueViewpointRecord,
  UserInteractionRecord,
  UserRecommendationContext,
} from './issue/repository/type/issueQuery.repository.js';
export { ISSUE_QUERY_REPOSITORY } from './issue/repository/type/issueQuery.repository.js';
export {
  AgeGroup,
  EntityType,
  OnboardingStatus,
  ONBOARDING_REPOSITORY,
} from './onboarding/onboarding.model.js';
export type {
  AgeGroupValue,
  EntityTypeValue,
  EntitySearchCommand,
  EntitySearchResult,
  OnboardingEntity,
  OnboardingOptions,
  OnboardingRepository,
  OnboardingState,
  OnboardingStateWithPreferences,
  MaybePromise,
  OnboardingTopicOption,
  RegionOption,
  CompleteOnboardingCommand,
} from './onboarding/onboarding.model.js';
export { OnboardingException, OnboardingExceptionCode } from './onboarding/onboarding.exception.js';
export type { OnboardingExceptionCodeValue } from './onboarding/onboarding.exception.js';
export {
  ONBOARDING_AGE_GROUPS,
  ONBOARDING_OPTIONS,
  ONBOARDING_REGIONS,
  ONBOARDING_TOPICS,
} from './onboarding/onboarding.options.js';
export {
  DEFAULT_ONBOARDING_ENTITY_FIXTURES,
  InMemoryOnboardingRepository,
} from './onboarding/inMemoryOnboarding.repository.js';
export { InMemoryOnboardingTransactionManager } from './onboarding/inMemoryOnboarding.transactionManager.js';
export { PostgresOnboardingRepository } from './onboarding/postgresOnboarding.repository.js';
export {
  AuthRole,
  toAuthAccount,
  toAuthPrincipal,
  toAuthSessionUser,
} from './auth/domain/auth.model.js';
export type {
  AuthAccount,
  AuthPrincipal,
  AuthRoleValue,
  AuthSessionUser,
  AuthUser,
  CreateAuthUserCommand,
  CreateRefreshSessionCommand,
  RotateRefreshSessionCommand,
  RotateRefreshSessionResult,
} from './auth/domain/auth.model.js';
export { AUTH_REPOSITORY } from './auth/repository/auth.repository.js';
export type { AuthRepository } from './auth/repository/auth.repository.js';
export { AuthException, AuthExceptionCode } from './auth/domain/auth.exception.js';
export type { AuthExceptionCodeValue } from './auth/domain/auth.exception.js';
export { PostgresAuthRepository } from './auth/postgresAuth.repository.js';
