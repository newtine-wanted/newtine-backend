import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  ARTICLE_BODY_PROVIDER,
  CANDIDATE_CLASSIFIER,
  CONTENT_GENERATOR,
  EMBEDDING_PROVIDER,
  NEWS_SEARCH_PROVIDER,
  PipelineException,
  PipelineExceptionCode,
  pipelineExternalException,
  SEMANTIC_VALIDATOR,
  validateGeneratedContent,
  validateSemanticResult,
  generateUuidV7,
  isUuidV7,
  isPipelineCategoryCode,
  normalizePipelineArticleUrl,
  type ArticleBodyProvider,
  type CandidateClassifier,
  type ContentGenerator,
  type DiscoveredArticle,
  type EmbeddingProvider,
  type FetchedArticle,
  type NewsSearchProvider,
  type PipelineFailureKind,
  type PipelineJobRecord,
  type PipelineRunRepository,
  type PipelineRunWork,
  type ProviderOutput,
  type ProviderUsageMetadata,
  type SemanticValidator,
  type UuidV7,
  type UsageRecordInput,
  PIPELINE_RUN_REPOSITORY,
} from '@newtine/core';
import {
  PipelineAiConfiguration,
  type PipelineAiUsageContext,
} from '@newtine/batch/pipeline/pipeline.ai.config.js';
import { DEFAULT_OPENAI_TEXT_MODEL } from '@newtine/batch/ai/ai-model.defaults.js';

@Injectable()
export class PipelineWorker implements OnModuleDestroy {
  private stopped = false;

  constructor(
    @Inject(PIPELINE_RUN_REPOSITORY) private readonly repository: PipelineRunRepository,
    @Inject(NEWS_SEARCH_PROVIDER) private readonly newsSearch: NewsSearchProvider,
    @Inject(ARTICLE_BODY_PROVIDER) private readonly bodyProvider: ArticleBodyProvider,
    @Inject(CANDIDATE_CLASSIFIER) private readonly candidateClassifier: CandidateClassifier,
    @Inject(CONTENT_GENERATOR) private readonly contentGenerator: ContentGenerator,
    @Inject(SEMANTIC_VALIDATOR) private readonly semanticValidator: SemanticValidator,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    private readonly logger: PinoLogger,
    @Optional() private readonly aiConfiguration?: PipelineAiConfiguration,
  ) {
    this.logger.setContext(PipelineWorker.name);
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  async runOnce(
    runExecutionId: ReturnType<typeof generateUuidV7> = generateUuidV7(),
    processExecutionId?: UuidV7,
  ): Promise<boolean> {
    const run = await this.repository.claimNext(runExecutionId);
    if (run === null) return false;
    this.logger.info(
      {
        event: 'pipeline.run.claimed',
        runId: run.id,
        runExecutionId: run.executionId,
        ...(processExecutionId === undefined ? {} : { processExecutionId }),
      },
      'Pipeline run claimed',
    );
    await this.processRun(run, processExecutionId);
    return true;
  }

  async runForever(
    pollIntervalMs = 1_000,
    signal?: AbortSignal,
    processExecutionId?: UuidV7,
  ): Promise<void> {
    while (!this.stopped && !signal?.aborted) {
      const processed = await this.runOnce(undefined, processExecutionId);
      if (!processed) await wait(pollIntervalMs, signal);
    }
  }

  private async processRun(run: PipelineRunWork, processExecutionId?: UuidV7): Promise<void> {
    try {
      if (run.retryScope === 'CONTENT') {
        await this.processQueuedJobs(run, processExecutionId);
        return;
      }
      const discovered = await this.externalCall(
        run,
        undefined,
        'SEARCH',
        'discovery search',
        () => this.newsSearch.search(run.request.query, run.request.limits.discoveryNews),
        undefined,
        processExecutionId,
      );
      const savedArticles = await this.repository.saveDiscoveredArticles(
        run.id,
        deduplicateArticles(discovered),
      );
      const existingIssues = await this.repository.loadExistingIssues('');
      const classified = await this.externalCall(
        run,
        undefined,
        'LLM',
        'candidate extraction and duplicate comparison',
        () =>
          this.candidateClassifier.classify({
            articles: savedArticles,
            existingIssues,
            maxCandidates: run.request.limits.maxCandidates,
          }),
        this.aiConfiguration?.usageContext('candidate'),
        processExecutionId,
      );
      if (!Array.isArray(classified))
        throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
      const decisions = classified.slice(0, run.request.limits.maxCandidates);
      const outcome = {
        discovered: savedArticles.length,
        duplicate: 0,
        uncertain: 0,
        created: 0,
        skippedByLimit: 0,
      };
      const createdTitles = new Set<string>();
      const savedArticleIds = new Set(
        savedArticles.flatMap((article) => (article.id === undefined ? [] : [article.id])),
      );
      for (const decision of decisions) {
        if (decision === null || typeof decision !== 'object') {
          outcome.uncertain += 1;
          continue;
        }
        if (
          decision.disposition !== 'DUPLICATE' &&
          decision.disposition !== 'NEW' &&
          decision.disposition !== 'UNCERTAIN'
        ) {
          outcome.uncertain += 1;
          continue;
        }
        const candidateTitle =
          typeof decision?.candidate?.title === 'string' ? decision.candidate.title : '';
        const candidateScope =
          typeof decision?.candidate?.scope === 'string' ? decision.candidate.scope : '';
        const sourceArticleIds = decision?.candidate?.sourceArticleIds;
        const candidateCategoryCode = decision?.candidate?.categoryCode;
        const normalizedCandidateTitle = normalizeTitle(candidateTitle);
        if (decision.disposition === 'DUPLICATE') {
          outcome.duplicate += 1;
          continue;
        }
        if (decision.disposition === 'UNCERTAIN') {
          outcome.uncertain += 1;
          continue;
        }
        if (
          candidateTitle.trim().length === 0 ||
          candidateScope.trim().length === 0 ||
          !isPipelineCategoryCode(candidateCategoryCode) ||
          !hasValidCandidateSources(sourceArticleIds, savedArticleIds)
        ) {
          outcome.uncertain += 1;
          continue;
        }
        if (
          existingIssues.some(
            (issue) => normalizeTitle(issue.title) === normalizedCandidateTitle,
          ) ||
          createdTitles.has(normalizedCandidateTitle)
        ) {
          outcome.duplicate += 1;
          continue;
        }
        if (outcome.created >= run.request.limits.maxNewIssues) {
          outcome.skippedByLimit += 1;
          continue;
        }
        const seedArticles = savedArticles.filter((article) =>
          sourceArticleIds.includes(article.id!),
        );
        const registration = await this.repository.registerIssue({
          runId: run.id,
          attempt: run.attempt,
          candidate: decision,
          seedArticles,
        });
        if (registration.outcome === 'duplicate') {
          outcome.duplicate += 1;
          continue;
        }
        createdTitles.add(normalizedCandidateTitle);
        outcome.created += 1;
      }
      outcome.skippedByLimit += Math.max(
        0,
        decisions.length -
          outcome.duplicate -
          outcome.uncertain -
          outcome.created -
          outcome.skippedByLimit,
      );
      await this.repository.completeDiscovery(run.id, run.attempt, run.executionId, outcome);
      await this.processQueuedJobs(run, processExecutionId);
    } catch (error: unknown) {
      const failureKind = toFailureKind(error);
      this.logger.error(
        {
          event: 'pipeline.run.failed',
          runId: run.id,
          runExecutionId: run.executionId,
          ...(processExecutionId === undefined ? {} : { processExecutionId }),
          failureKind,
        },
        'Pipeline run failed',
      );
      await this.repository.failRun(
        run.id,
        run.attempt,
        run.executionId,
        failureKind,
        safeFailureMessage(failureKind),
      );
    }
  }

  private async processQueuedJobs(
    run: PipelineRunWork,
    processExecutionId?: UuidV7,
  ): Promise<void> {
    const runnableJobs = await this.repository.listJobs(run.id, run.attempt);
    for (const job of runnableJobs) {
      if (this.stopped) break;
      const claimed = await this.repository.claimJob(job.id, run.attempt, run.executionId);
      if (claimed !== null) await this.processJob(run, claimed, processExecutionId);
    }
    if (this.stopped) return;
    await this.repository.completeRun(run.id, run.attempt, run.executionId);
  }

  private async processJob(
    run: PipelineRunWork,
    job: PipelineJobRecord,
    processExecutionId?: UuidV7,
  ): Promise<void> {
    try {
      await this.repository.updateRunStage(run.id, run.attempt, run.executionId, 'SEARCH');
      await this.repository.updateJobStage(job.id, run.attempt, run.executionId, 'SEARCH');
      const issue = await this.repository.loadIssue(job.issueId);
      if (issue === null) throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
      const seedArticles = await this.repository.loadSeedArticles(job.issueId);
      const relatedQueries = [issue.title, ...seedArticles.map((article) => article.title)].slice(
        0,
        run.request.limits.issueSearchQueries,
      );
      const relatedResults: DiscoveredArticle[] = [];
      for (const query of relatedQueries) {
        const related = await this.externalCall(
          run,
          job.id,
          'SEARCH',
          'related article search',
          () => this.newsSearch.search(query, run.request.limits.relatedArticlesPerQuery),
          undefined,
          processExecutionId,
        );
        relatedResults.push(...related);
      }
      const savedRelated = await this.repository.saveDiscoveredArticles(run.id, relatedResults);
      const candidates = deduplicateArticles([...seedArticles, ...savedRelated]).slice(
        0,
        run.request.limits.maxBodyAttempts,
      );

      await this.repository.updateRunStage(run.id, run.attempt, run.executionId, 'FETCH');
      await this.repository.updateJobStage(job.id, run.attempt, run.executionId, 'FETCH');
      const fetched: FetchedArticle[] = [];
      const fetchFailures: PipelineFailureKind[] = [];
      for (const article of candidates) {
        if (fetched.length >= run.request.limits.validBodiesTarget) break;
        try {
          const body = await this.externalCall(
            run,
            job.id,
            'FETCH',
            'article body fetch',
            () => this.bodyProvider.fetch(article),
            undefined,
            processExecutionId,
          );
          if (!isFetchedArticleFor(body, article)) {
            throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
          }
          if (body.body.trim().length > 0) fetched.push(body);
        } catch (error: unknown) {
          const failureKind = toFailureKind(error);
          fetchFailures.push(failureKind);
          this.logger.warn(
            {
              event: 'pipeline.article.fetch_failed',
              runId: run.id,
              runExecutionId: run.executionId,
              jobId: job.id,
              ...(processExecutionId === undefined ? {} : { processExecutionId }),
              failureKind,
            },
            'Article body fetch failed',
          );
        }
      }
      if (fetched.length < 2) throw classifyFetchFailure(fetched.length, fetchFailures);

      await this.repository.updateRunStage(run.id, run.attempt, run.executionId, 'GENERATE');
      await this.repository.updateJobStage(job.id, run.attempt, run.executionId, 'GENERATE');
      const content = await this.externalCall(
        run,
        job.id,
        'LLM',
        'issue content generation',
        () =>
          this.contentGenerator.generate({
            issueId: job.issueId,
            title: issue.title,
            articles: fetched,
          }),
        this.aiConfiguration?.usageContext('content'),
        processExecutionId,
      );
      const structure = validateGeneratedContent(content, fetched);
      if (!structure.ok) {
        this.logger.warn(
          {
            event: 'pipeline.content.validation_failed',
            runId: run.id,
            runExecutionId: run.executionId,
            jobId: job.id,
            failureKind: 'INVALID_OUTPUT',
            validationReason: safeValidationReason(structure.reason),
            fetchedArticleCount: fetched.length,
            ...(processExecutionId === undefined ? {} : { processExecutionId }),
          },
          'Generated content failed structural validation',
        );
        throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
      }

      await this.repository.updateRunStage(run.id, run.attempt, run.executionId, 'VALIDATE');
      await this.repository.updateJobStage(job.id, run.attempt, run.executionId, 'VALIDATE');
      const validation = await this.externalCall(
        run,
        job.id,
        'LLM',
        'semantic content validation',
        () => this.semanticValidator.validate({ issueId: job.issueId, content, articles: fetched }),
        this.aiConfiguration?.usageContext('validation'),
        processExecutionId,
      );
      const semantic = validateSemanticResult(validation, fetched);
      if (!semantic.ok) {
        this.logger.warn(
          {
            event: 'pipeline.content.semantic_validation_failed',
            runId: run.id,
            runExecutionId: run.executionId,
            jobId: job.id,
            failureKind: 'INVALID_OUTPUT',
            validationStatus: validation.status,
            fetchedArticleCount: fetched.length,
            ...(processExecutionId === undefined ? {} : { processExecutionId }),
          },
          'Generated content failed semantic validation',
        );
        throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
      }
      const accepted = await this.repository.saveJobSuccess(
        job.id,
        run.attempt,
        run.executionId,
        content,
        validation,
        fetched,
        this.aiConfiguration?.stage('embedding').model,
      );
      if (!accepted) return;

      const currentIssue = await this.repository.loadIssue(job.issueId);
      if (currentIssue?.publicationStatus !== 'PUBLISHED') return;

      try {
        const embeddingModel =
          this.aiConfiguration?.stage('embedding').model ?? 'text-embedding-3-small';
        const embedding = await this.externalCall(
          run,
          job.id,
          'EMBED',
          'issue embedding maintenance',
          () =>
            this.embeddingProvider.embed(
              `${issue.title}\n${content.integratedSummary}`,
              embeddingModel,
            ),
          this.aiConfiguration?.usageContext('embedding'),
          processExecutionId,
        );
        if (
          embedding.vector.length !==
            (this.aiConfiguration?.stage('embedding').dimension ?? 1_536) ||
          embedding.vector.some((value) => !Number.isFinite(value))
        )
          throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
        const savedEmbedding = await this.repository.saveEmbedding(
          job.issueId,
          issue.title,
          content.integratedSummary,
          embedding.vector,
          embedding.model,
          undefined,
          undefined,
          embeddingModel,
        );
        if (savedEmbedding === 'STALE') {
          this.logger.warn(
            {
              event: 'pipeline.embedding.stale',
              runId: run.id,
              runExecutionId: run.executionId,
              jobId: job.id,
              ...(processExecutionId === undefined ? {} : { processExecutionId }),
            },
            'Embedding result was stale and was not persisted',
          );
        }
      } catch (error: unknown) {
        await this.repository.markEmbeddingPending(
          run.id,
          run.attempt,
          run.executionId,
          job.id,
          safeFailureMessage(toFailureKind(error)),
        );
        this.logger.warn(
          {
            event: 'pipeline.embedding.pending',
            runId: run.id,
            runExecutionId: run.executionId,
            jobId: job.id,
            ...(processExecutionId === undefined ? {} : { processExecutionId }),
            failureKind: toFailureKind(error),
          },
          'Embedding maintenance failed',
        );
      }
    } catch (error: unknown) {
      const failureKind = toFailureKind(error);
      await this.repository.saveJobFailure(
        job.id,
        run.attempt,
        run.executionId,
        failureKind,
        safeFailureMessage(failureKind),
      );
    }
  }

  private async externalCall<T>(
    run: PipelineRunWork,
    jobId: PipelineJobRecord['id'] | undefined,
    operation: UsageRecordInput['operation'],
    purpose: string,
    call: () => Promise<ProviderOutput<T>>,
    usageContext?: PipelineAiUsageContext,
    processExecutionId?: UuidV7,
  ): Promise<T> {
    let retryCount = 0;
    while (true) {
      const startedAt = new Date().toISOString();
      try {
        const result = unwrapProviderOutput(await call());
        await this.tryRecordUsage(
          {
            runId: run.id,
            runAttempt: run.attempt,
            ...(jobId === undefined ? {} : { jobId }),
            operation,
            purpose,
            ...(usageContext?.promptVersion === undefined
              ? {}
              : { promptVersion: usageContext.promptVersion }),
            ...(usageContext?.promptHash === undefined
              ? {}
              : { promptHash: usageContext.promptHash }),
            provider: operation === 'SEARCH' || operation === 'FETCH' ? 'naver' : 'openai',
            model: result.usage?.model ?? usageContext?.model ?? usageModel(operation),
            status: 'SUCCEEDED',
            ...(result.usage?.requestId === undefined ? {} : { requestId: result.usage.requestId }),
            ...(result.usage?.inputTokens === undefined
              ? {}
              : { inputTokens: result.usage.inputTokens }),
            ...(result.usage?.outputTokens === undefined
              ? {}
              : { outputTokens: result.usage.outputTokens }),
            startedAt,
            finishedAt: new Date().toISOString(),
          },
          { runExecutionId: run.executionId, processExecutionId },
        );
        return result.value;
      } catch (error: unknown) {
        await this.tryRecordUsage(
          {
            runId: run.id,
            runAttempt: run.attempt,
            ...(jobId === undefined ? {} : { jobId }),
            operation,
            purpose,
            ...(usageContext?.promptVersion === undefined
              ? {}
              : { promptVersion: usageContext.promptVersion }),
            ...(usageContext?.promptHash === undefined
              ? {}
              : { promptHash: usageContext.promptHash }),
            provider: operation === 'SEARCH' || operation === 'FETCH' ? 'naver' : 'openai',
            model: usageContext?.model ?? usageModel(operation),
            status: usageStatusForFailure(error),
            errorCode: toFailureKind(error),
            startedAt,
            finishedAt: new Date().toISOString(),
          },
          { runExecutionId: run.executionId, processExecutionId },
        );
        if (
          !(error instanceof PipelineException) ||
          !error.retryable ||
          retryCount >= run.request.limits.transientRetries
        ) {
          throw error;
        }
        retryCount += 1;
      }
    }
  }

  private async tryRecordUsage(
    input: UsageRecordInput,
    context: { runExecutionId: UuidV7; processExecutionId?: UuidV7 },
  ): Promise<void> {
    try {
      await this.repository.recordUsage(input);
    } catch {
      this.logger.warn(
        {
          event: 'pipeline.usage.record_failed',
          runId: input.runId,
          runExecutionId: context.runExecutionId,
          ...(context.processExecutionId === undefined
            ? {}
            : { processExecutionId: context.processExecutionId }),
        },
        'Pipeline usage record failed',
      );
    }
  }
}

function deduplicateArticles(articles: DiscoveredArticle[]): DiscoveredArticle[] {
  const seen = new Set<string>();
  return articles.filter((article) => {
    const key = normalizePipelineArticleUrl(article.sourceUrl);
    if (key.length === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasValidCandidateSources(
  value: unknown,
  available: ReadonlySet<UuidV7>,
): value is UuidV7[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((id) => typeof id === 'string' && available.has(id as UuidV7))
  );
}

function isFetchedArticleFor(value: unknown, expected: DiscoveredArticle): value is FetchedArticle {
  if (
    expected.id === undefined ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }
  const article = value as Record<string, unknown>;
  return (
    article.articleId === expected.id &&
    isUuidV7(article.articleId as string) &&
    typeof article.title === 'string' &&
    typeof article.sourceUrl === 'string' &&
    typeof article.publisherName === 'string' &&
    typeof article.body === 'string' &&
    article.title.trim() === expected.title.trim() &&
    article.sourceUrl.trim() === expected.sourceUrl.trim() &&
    article.publisherName.trim() === expected.publisherName.trim() &&
    (expected.publishedAt === undefined || article.publishedAt === expected.publishedAt)
  );
}

function unwrapProviderOutput<T>(output: ProviderOutput<T>): {
  value: T;
  usage?: ProviderUsageMetadata;
} {
  if (isProviderResult(output)) return output;
  return { value: output };
}

function isProviderResult<T>(output: ProviderOutput<T>): output is {
  value: T;
  usage?: ProviderUsageMetadata;
} {
  return (
    typeof output === 'object' &&
    output !== null &&
    !Array.isArray(output) &&
    'value' in output &&
    (Object.keys(output).length === 1 || 'usage' in output)
  );
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function usageModel(operation: UsageRecordInput['operation']): string | undefined {
  if (operation === 'EMBED') return 'text-embedding-3-small';
  if (operation === 'LLM') return DEFAULT_OPENAI_TEXT_MODEL;
  return undefined;
}

function toFailureKind(error: unknown): PipelineFailureKind {
  if (error instanceof PipelineException) {
    switch (error.code) {
      case PipelineExceptionCode.SourceUnavailable:
        return 'SOURCE_UNAVAILABLE';
      case PipelineExceptionCode.InsufficientEvidence:
        return 'INSUFFICIENT_EVIDENCE';
      case PipelineExceptionCode.InvalidOutput:
        return 'INVALID_OUTPUT';
      case PipelineExceptionCode.InvalidInput:
        return 'INVALID_OUTPUT';
      case PipelineExceptionCode.UpstreamError:
        return 'UPSTREAM_ERROR';
      default:
        return 'UPSTREAM_ERROR';
    }
  }
  return 'UPSTREAM_ERROR';
}

function classifyFetchFailure(
  fetchedCount: number,
  failures: readonly PipelineFailureKind[],
): PipelineException {
  if (
    fetchedCount === 0 &&
    failures.length > 0 &&
    failures.every((failure) => failure === 'UPSTREAM_ERROR')
  ) {
    return pipelineExternalException(PipelineExceptionCode.UpstreamError);
  }
  if (
    fetchedCount === 0 &&
    failures.length > 0 &&
    failures.every((failure) => failure === 'SOURCE_UNAVAILABLE')
  ) {
    return pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
  }
  return pipelineExternalException(PipelineExceptionCode.InsufficientEvidence);
}

function usageStatusForFailure(error: unknown): 'FAILED' | 'UNKNOWN' {
  return error instanceof PipelineException && error.resultUncertain ? 'UNKNOWN' : 'FAILED';
}

function safeFailureMessage(kind: PipelineFailureKind): string {
  switch (kind) {
    case 'SOURCE_UNAVAILABLE':
      return '필요한 기사 본문을 확보하지 못했습니다.';
    case 'INSUFFICIENT_EVIDENCE':
      return '독립 근거가 충분하지 않습니다.';
    case 'INVALID_OUTPUT':
      return '생성 결과가 서비스 검증을 통과하지 못했습니다.';
    case 'INTERRUPTED':
      return '실행이 중단되어 완료되지 않았습니다.';
    default:
      return '외부 처리 중 오류가 발생했습니다.';
  }
}

function safeValidationReason(reason: string): string {
  return Array.from(reason, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  })
    .join('')
    .slice(0, 200);
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = (): void => finish();
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) finish();
  });
}
