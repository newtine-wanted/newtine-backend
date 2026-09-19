import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { generateUuidV7, isUuidV7, type UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import {
  PipelineException,
  PipelineExceptionCode,
} from '@newtine/core/pipeline/domain/pipeline.exception.js';
import { MAX_FAILED_JOB_IDS } from '@newtine/core/pipeline/domain/pipeline.limits.js';
import {
  validateGeneratedContent,
  validateSemanticResult,
} from '@newtine/core/pipeline/domain/pipeline.validator.js';
import { normalizePipelineArticleUrl } from '@newtine/core/pipeline/domain/pipeline.url.js';
import { isPipelineCategoryCode } from '@newtine/core/pipeline/domain/pipeline.types.js';
import type {
  DiscoveredArticle,
  DiscoveryOutcome,
  ExistingIssueSummary,
  FetchedArticle,
  GeneratedIssueContent,
  PipelineEmbeddingTask,
  PipelineJobRecord,
  PipelineJobStage,
  PipelineRunSnapshot,
  PipelineRunWork,
  PipelineUsageSummary,
  SemanticValidationResult,
  UsageRecordInput,
} from '@newtine/core/pipeline/domain/pipeline.types.js';
import type {
  EnqueuePipelineRunInput,
  InterruptPipelineRunInput,
  PipelineRunRepository,
  RegisterIssueInput,
  RegisterIssueResult,
  RetryPipelineRunInput,
} from './pipeline.repository.js';

@Injectable()
export class InMemoryPipelineRepository implements PipelineRunRepository {
  private readonly runs = new Map<UuidV7, PipelineRunSnapshot>();
  private readonly articles = new Map<UuidV7, DiscoveredArticle>();
  private readonly issues: ExistingIssueSummary[] = [];
  private readonly seedArticleIds = new Map<UuidV7, Set<UuidV7>>();
  private readonly usages: UsageRecordInput[] = [];
  private readonly embeddingTasks = new Map<UuidV7, PipelineEmbeddingTask>();

  async enqueue(input: EnqueuePipelineRunInput): Promise<PipelineRunSnapshot> {
    const existing = [...this.runs.values()].find(
      (run) => run.idempotencyKey === input.idempotencyKey,
    );
    if (existing !== undefined) {
      if (existing.requestHash !== input.requestHash) {
        throw new PipelineException(
          PipelineExceptionCode.IdempotencyConflict,
          '멱등 키가 다른 요청에 사용되었습니다.',
        );
      }
      return cloneRun(existing);
    }
    if (
      [...this.runs.values()].some((run) => run.status === 'QUEUED' || run.status === 'RUNNING')
    ) {
      throw new PipelineException(
        PipelineExceptionCode.ActiveRunConflict,
        '이미 실행 중인 파이프라인이 있습니다.',
      );
    }
    const now = new Date().toISOString();
    const run: PipelineRunSnapshot = {
      id: generateUuidV7(),
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      request: structuredClone(input.request),
      status: 'QUEUED',
      attempt: 1,
      retryJobIds: [],
      candidateCounts: { discovered: 0, duplicate: 0, uncertain: 0, created: 0, skippedByLimit: 0 },
      jobs: [],
      embeddingPendingCount: 0,
      usageSummary: emptyUsageSummary(),
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    return cloneRun(run);
  }

  async findById(runId: UuidV7): Promise<PipelineRunSnapshot | null> {
    const run = this.runs.get(runId);
    return run === undefined ? null : cloneRun(run);
  }

  async retry(input: RetryPipelineRunInput): Promise<PipelineRunSnapshot> {
    if (input.failedJobIds !== undefined && input.failedJobIds.length > MAX_FAILED_JOB_IDS) {
      throw new PipelineException(
        PipelineExceptionCode.RetryNotAllowed,
        `failedJobIds는 최대 ${MAX_FAILED_JOB_IDS}개까지 지정할 수 있습니다.`,
      );
    }
    if (
      input.scope === 'CONTENT' &&
      (!Array.isArray(input.failedJobIds) || input.failedJobIds.length === 0)
    ) {
      throw new PipelineException(
        PipelineExceptionCode.RetryNotAllowed,
        'CONTENT 재시도에는 하나 이상의 failedJobIds가 필요합니다.',
      );
    }
    const run = this.requireRun(input.runId);
    if (run.attempt !== input.expectedAttempt) {
      throw new PipelineException(
        PipelineExceptionCode.StaleAttempt,
        '실행 시도가 변경되었습니다. 최신 상태를 다시 확인하세요.',
      );
    }
    if (run.status !== 'FAILED' && run.status !== 'PARTIALLY_SUCCEEDED') {
      throw new PipelineException(
        PipelineExceptionCode.RetryNotAllowed,
        '현재 상태에서는 수동 재시도를 할 수 없습니다.',
      );
    }
    if (
      [...this.runs.values()].some(
        (item) => item.id !== run.id && (item.status === 'QUEUED' || item.status === 'RUNNING'),
      )
    ) {
      throw new PipelineException(
        PipelineExceptionCode.ActiveRunConflict,
        '이미 실행 중인 파이프라인이 있습니다.',
      );
    }
    const selectedIds = input.failedJobIds;
    const selected = new Set(selectedIds ?? []);
    if (selectedIds !== undefined) {
      if (
        selectedIds.length === 0 ||
        selected.size !== selectedIds.length ||
        [...selected].some((id) => {
          const job = run.jobs.find((item) => item.id === id);
          const issue =
            job === undefined ? undefined : this.issues.find((item) => item.id === job.issueId);
          return (
            job === undefined || job.status !== 'FAILED' || issue?.publicationStatus === 'WITHDRAWN'
          );
        })
      ) {
        throw new PipelineException(
          PipelineExceptionCode.RetryNotAllowed,
          '실패한 job만 재시도 대상으로 지정할 수 있습니다.',
        );
      }
    }
    if (input.scope === 'CONTENT') {
      if (run.jobs.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING')) {
        throw new PipelineException(
          PipelineExceptionCode.RetryNotAllowed,
          '미완료 job이 있으면 CONTENT 재시도 전에 DISCOVERY 재시도가 필요합니다.',
        );
      }
      const contentTargets = run.jobs.filter((job) => selected.has(job.id));
      if (
        contentTargets.length === 0 ||
        contentTargets.some((job) => {
          const issue = this.issues.find((item) => item.id === job.issueId);
          return issue?.publicationStatus === 'WITHDRAWN';
        })
      ) {
        throw new PipelineException(
          PipelineExceptionCode.RetryNotAllowed,
          '실패한 콘텐츠 job만 CONTENT 재시도 대상으로 지정할 수 있습니다.',
        );
      }
    }
    run.attempt += 1;
    run.status = 'QUEUED';
    run.retryScope = input.scope;
    run.retryJobIds = [...selected];
    run.executionId = undefined;
    run.currentStage = undefined;
    run.finishedAt = undefined;
    run.lastError = undefined;
    run.updatedAt = new Date().toISOString();
    for (const job of run.jobs) {
      if (job.status === 'SUCCEEDED') continue;
      const issue = this.issues.find((item) => item.id === job.issueId);
      if (issue?.publicationStatus === 'WITHDRAWN') continue;
      const retryDiscoveryJob =
        job.status === 'QUEUED' ||
        job.status === 'RUNNING' ||
        (job.status === 'FAILED' && (job.failureKind === 'INTERRUPTED' || selected.has(job.id)));
      if ((input.scope === 'DISCOVERY' && retryDiscoveryJob) || selected.has(job.id)) {
        job.status = 'QUEUED';
        job.stage = 'SEARCH';
        job.failureKind = undefined;
        job.lastError = undefined;
        job.attempt = run.attempt;
      }
    }
    return cloneRun(run);
  }

  async interrupt(input: InterruptPipelineRunInput): Promise<PipelineRunSnapshot> {
    const run = this.requireRun(input.runId);
    if (run.attempt !== input.expectedAttempt) {
      throw new PipelineException(
        PipelineExceptionCode.StaleAttempt,
        '실행 시도가 변경되었습니다. 최신 상태를 다시 확인하세요.',
      );
    }
    if (run.status !== 'RUNNING') {
      throw new PipelineException(
        PipelineExceptionCode.RetryNotAllowed,
        'RUNNING 상태의 실행만 중단 처리할 수 있습니다.',
      );
    }
    if (run.executionId !== input.executionId) {
      throw new PipelineException(
        PipelineExceptionCode.ClaimConflict,
        '실행 소유자가 일치하지 않습니다.',
      );
    }
    const now = new Date().toISOString();
    const unfinished = run.jobs.filter(
      (job) => job.status === 'QUEUED' || job.status === 'RUNNING',
    );
    for (const job of unfinished) {
      job.status = 'FAILED';
      job.failureKind = 'INTERRUPTED';
      job.lastError = '실행 프로세스 종료가 확인되어 중단 처리되었습니다.';
    }
    const success = run.jobs.filter((job) => job.status === 'SUCCEEDED').length;
    const failed = run.jobs.filter((job) => job.status === 'FAILED').length;
    run.status =
      run.jobs.length > 0 && failed === 0 && success === run.jobs.length
        ? 'SUCCEEDED'
        : run.jobs.length > 0 && success > 0
          ? 'PARTIALLY_SUCCEEDED'
          : 'FAILED';
    run.lastError =
      run.status === 'SUCCEEDED' ? undefined : '실행 프로세스 종료가 확인되어 중단 처리되었습니다.';
    run.finishedAt = now;
    run.updatedAt = now;
    return cloneRun(run);
  }

  async claimNext(executionId: UuidV7): Promise<PipelineRunWork | null> {
    const run = [...this.runs.values()]
      .filter((item) => item.status === 'QUEUED')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (run === undefined) return null;
    run.status = 'RUNNING';
    run.executionId = executionId;
    run.startedAt ??= new Date().toISOString();
    run.updatedAt = new Date().toISOString();
    return { ...cloneRun(run), executionId };
  }

  async saveDiscoveredArticles(
    _runId: UuidV7,
    articles: DiscoveredArticle[],
  ): Promise<DiscoveredArticle[]> {
    return articles.map((article) => {
      const existing = [...this.articles.values()].find(
        (item) =>
          normalizePipelineArticleUrl(item.sourceUrl) ===
          normalizePipelineArticleUrl(article.sourceUrl),
      );
      const saved =
        existing === undefined
          ? { ...article, id: generateUuidV7() }
          : {
              ...existing,
              title: article.title,
              description: article.description,
              naverUrl: article.naverUrl ?? existing.naverUrl,
              publisherName: article.publisherName,
              publishedAt: article.publishedAt ?? existing.publishedAt,
            };
      this.articles.set(saved.id!, saved);
      return { ...saved };
    });
  }

  async loadExistingIssues(query: string): Promise<ExistingIssueSummary[]> {
    const normalized = query.toLocaleLowerCase();
    return this.issues
      .filter((issue) => issue.title.toLocaleLowerCase().includes(normalized))
      .map((item) => ({ ...item }));
  }

  async loadIssue(issueId: UuidV7): Promise<ExistingIssueSummary | null> {
    const issue = this.issues.find((item) => item.id === issueId);
    return issue === undefined ? null : { ...issue };
  }

  async loadSeedArticles(_issueId: UuidV7): Promise<DiscoveredArticle[]> {
    const ids = this.seedArticleIds.get(_issueId) ?? new Set<UuidV7>();
    return [...this.articles.values()]
      .filter((article) => article.id !== undefined && ids.has(article.id))
      .map((article) => ({ ...article }));
  }

  async registerIssue(input: RegisterIssueInput): Promise<RegisterIssueResult> {
    if (!isPipelineCategoryCode(input.candidate?.candidate?.categoryCode)) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        '이슈 category code가 올바르지 않습니다.',
      );
    }
    const run = this.requireRun(input.runId);
    if (run.attempt !== input.attempt || (run.status !== 'QUEUED' && run.status !== 'RUNNING')) {
      throw new PipelineException(
        PipelineExceptionCode.ClaimConflict,
        '현재 실행 시도에서 이슈를 등록할 수 없습니다.',
      );
    }
    validateSeedLineage(input);
    const candidateTitle = input.candidate.candidate.title;
    if (typeof candidateTitle !== 'string' || normalizeTitle(candidateTitle).length === 0) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        '이슈 제목은 비어 있지 않은 문자열이어야 합니다.',
      );
    }
    const normalizedTitle = normalizeTitle(candidateTitle);
    if (this.issues.some((issue) => normalizeTitle(issue.title) === normalizedTitle))
      return { outcome: 'duplicate' };
    const issueId = generateUuidV7();
    this.issues.push({
      id: issueId,
      title: input.candidate.candidate.title,
      publicationStatus: 'UNPUBLISHED',
    });
    this.seedArticleIds.set(
      issueId,
      new Set(
        input.seedArticles.flatMap((article) => (article.id === undefined ? [] : [article.id])),
      ),
    );
    const job: PipelineJobRecord = {
      id: generateUuidV7(),
      runId: input.runId,
      issueId,
      status: 'QUEUED',
      stage: 'SEARCH',
      attempt: run.attempt,
    };
    run.jobs.push(job);
    run.updatedAt = new Date().toISOString();
    return { outcome: 'created', job: { ...job } };
  }

  async completeDiscovery(
    runId: UuidV7,
    _attempt: number,
    _executionId: UuidV7,
    outcome: DiscoveryOutcome,
  ): Promise<void> {
    const run = this.requireRun(runId);
    if (run.attempt !== _attempt || run.executionId !== _executionId || run.status !== 'RUNNING')
      return;
    run.candidateCounts = { ...outcome };
    run.updatedAt = new Date().toISOString();
  }

  async failRun(
    runId: UuidV7,
    _attempt: number,
    _executionId: UuidV7,
    _failureKind: string,
    message: string,
  ): Promise<void> {
    const run = this.requireRun(runId);
    if (run.attempt !== _attempt || run.executionId !== _executionId || run.status !== 'RUNNING')
      return;
    run.status = 'FAILED';
    run.lastError = message;
    run.finishedAt = new Date().toISOString();
    run.updatedAt = run.finishedAt;
  }

  async listJobs(runId: UuidV7, _attempt: number): Promise<PipelineJobRecord[]> {
    void _attempt;
    return this.requireRun(runId).jobs.map((job) => ({ ...job }));
  }

  async claimJob(
    jobId: UuidV7,
    attempt: number,
    _executionId: UuidV7,
  ): Promise<PipelineJobRecord | null> {
    const owner = this.findJobOwner(jobId);
    if (
      owner === undefined ||
      owner.run.executionId !== _executionId ||
      owner.run.status !== 'RUNNING'
    )
      return null;
    const job = owner.job;
    if (job === undefined || job.status !== 'QUEUED' || job.attempt !== attempt) return null;
    job.status = 'RUNNING';
    return { ...job };
  }

  async updateRunStage(
    runId: UuidV7,
    attempt: number,
    _executionId: UuidV7,
    stage: PipelineJobStage,
  ): Promise<void> {
    const run = this.requireRun(runId);
    if (run.attempt === attempt && run.executionId === _executionId && run.status === 'RUNNING')
      run.currentStage = stage;
  }

  async updateJobStage(
    jobId: UuidV7,
    attempt: number,
    _executionId: UuidV7,
    stage: PipelineJobStage,
  ): Promise<void> {
    const owner = this.findJobOwner(jobId);
    if (
      owner === undefined ||
      owner.run.executionId !== _executionId ||
      owner.run.status !== 'RUNNING'
    )
      return;
    const job = owner.job;
    if (job.attempt !== attempt || job.status !== 'RUNNING') return;
    job.stage = stage;
  }

  async saveJobSuccess(
    jobId: UuidV7,
    attempt: number,
    _executionId: UuidV7,
    content: GeneratedIssueContent,
    validation: SemanticValidationResult,
    evidence: FetchedArticle[],
    embeddingModel = 'text-embedding-3-small',
  ): Promise<boolean> {
    if (
      !validateGeneratedContent(content, evidence).ok ||
      !validateSemanticResult(validation, evidence).ok
    ) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        '검증을 통과한 콘텐츠만 공개할 수 있습니다.',
      );
    }
    const owner = this.findJobOwner(jobId);
    if (
      owner === undefined ||
      owner.run.executionId !== _executionId ||
      owner.run.status !== 'RUNNING'
    )
      return false;
    const job = owner.job;
    if (job.attempt !== attempt || job.status !== 'RUNNING') return false;
    const issue = this.issues.find((item) => item.id === job.issueId);
    if (issue?.publicationStatus === 'WITHDRAWN') {
      throw new PipelineException(
        PipelineExceptionCode.RetryNotAllowed,
        '공개 중단된 이슈는 자동 재공개하지 않습니다.',
      );
    }
    job.status = 'SUCCEEDED';
    job.stage = 'VALIDATE';
    job.failureKind = undefined;
    if (issue !== undefined) {
      issue.publicationStatus = 'PUBLISHED';
      issue.integratedSummary = content.integratedSummary;
      const inputHash = embeddingInputHash(issue.title, content.integratedSummary);
      const existingTask = this.embeddingTasks.get(issue.id);
      const completed =
        existingTask?.status === 'SUCCEEDED' &&
        existingTask.inputHash === inputHash &&
        existingTask.model === embeddingModel;
      this.embeddingTasks.set(issue.id, {
        id: existingTask?.id ?? generateUuidV7(),
        issueId: issue.id,
        runId: owner.run.id,
        jobId,
        runAttempt: attempt,
        ...(owner.run.executionId === undefined ? {} : { runExecutionId: owner.run.executionId }),
        inputHash,
        model: embeddingModel,
        status: completed ? 'SUCCEEDED' : 'PENDING',
        attempts: existingTask?.attempts ?? 0,
        title: issue.title,
        integratedSummary: content.integratedSummary,
        ...(completed || existingTask?.claimToken === undefined ? {} : { claimToken: undefined }),
        ...(completed || existingTask?.claimedByProcessExecutionId === undefined
          ? {}
          : { claimedByProcessExecutionId: undefined }),
        ...(completed || existingTask?.claimedAt === undefined ? {} : { claimedAt: undefined }),
        ...(completed || existingTask?.lastError === undefined ? {} : { lastError: undefined }),
      });
      recomputeEmbeddingPendingCounts(this.runs, this.embeddingTasks, this.issues);
    }
    owner.run.updatedAt = new Date().toISOString();
    return true;
  }

  async saveJobFailure(
    jobId: UuidV7,
    attempt: number,
    _executionId: UuidV7,
    failureKind: PipelineJobRecord['failureKind'],
    message: string,
  ): Promise<void> {
    const owner = this.findJobOwner(jobId);
    if (
      owner === undefined ||
      owner.run.executionId !== _executionId ||
      owner.run.status !== 'RUNNING'
    )
      return;
    const job = owner.job;
    if (job.attempt !== attempt || job.status !== 'RUNNING') return;
    job.status = 'FAILED';
    job.failureKind = failureKind;
    job.lastError = message;
    owner.run.updatedAt = new Date().toISOString();
  }

  async completeRun(runId: UuidV7, _attempt: number, _executionId: UuidV7): Promise<void> {
    const run = this.requireRun(runId);
    if (run.attempt !== _attempt || run.executionId !== _executionId || run.status !== 'RUNNING')
      return;
    if (run.jobs.some((job) => job.status !== 'SUCCEEDED' && job.status !== 'FAILED')) return;
    const success = run.jobs.filter((job) => job.status === 'SUCCEEDED').length;
    const failed = run.jobs.filter((job) => job.status === 'FAILED').length;
    run.status = failed === 0 ? 'SUCCEEDED' : success === 0 ? 'FAILED' : 'PARTIALLY_SUCCEEDED';
    run.finishedAt = new Date().toISOString();
    run.updatedAt = run.finishedAt;
  }

  async recordUsage(input: UsageRecordInput): Promise<void> {
    this.usages.push(structuredClone(input));
    const run = this.runs.get(input.runId);
    if (run === undefined) return;
    run.usageSummary.calls += 1;
    if (input.status === 'SUCCEEDED') run.usageSummary.succeededCalls += 1;
    if (input.status === 'FAILED') run.usageSummary.failedCalls += 1;
    if (input.status === 'UNKNOWN') run.usageSummary.unknownCalls += 1;
    run.usageSummary.inputTokens += input.inputTokens ?? 0;
    run.usageSummary.outputTokens += input.outputTokens ?? 0;
    if (input.actualCost !== undefined) {
      run.usageSummary.actualCost = (run.usageSummary.actualCost ?? 0) + input.actualCost;
    }
    run.updatedAt = new Date().toISOString();
  }

  async saveEmbedding(
    issueId: UuidV7,
    title: string,
    integratedSummary: string,
    embedding: number[],
    model: string,
    taskId?: UuidV7,
    claimToken?: UuidV7,
    expectedModel?: string,
  ): Promise<'SAVED' | 'STALE'> {
    if (embedding.length !== 1_536 || embedding.some((value) => !Number.isFinite(value))) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidOutput,
        '임베딩 벡터 차원이 올바르지 않습니다.',
      );
    }
    const task = this.embeddingTasks.get(issueId);
    const issue = this.issues.find((item) => item.id === issueId);
    const targetModel = expectedModel ?? task?.model;
    if (
      issue?.publicationStatus !== 'PUBLISHED' ||
      task === undefined ||
      task.inputHash !== embeddingInputHash(title, integratedSummary) ||
      (taskId !== undefined && task.id !== taskId) ||
      targetModel === undefined ||
      task.model !== targetModel ||
      model !== targetModel ||
      (taskId === undefined
        ? claimToken !== undefined || task.status !== 'PENDING'
        : claimToken === undefined || task.status !== 'RUNNING' || task.claimToken !== claimToken)
    )
      return 'STALE';
    task.status = 'SUCCEEDED';
    if (taskId === undefined) task.attempts += 1;
    task.lastError = undefined;
    task.claimToken = undefined;
    task.claimedByProcessExecutionId = undefined;
    task.claimedAt = undefined;
    recomputeEmbeddingPendingCounts(this.runs, this.embeddingTasks, this.issues);
    return 'SAVED';
  }

  async markEmbeddingPending(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    jobId: UuidV7,
    message?: string,
  ): Promise<void> {
    const run = this.runs.get(runId);
    const owner = this.findJobOwner(jobId);
    if (
      run === undefined ||
      owner === undefined ||
      owner.run !== run ||
      run.attempt !== attempt ||
      run.executionId !== executionId ||
      (run.status !== 'RUNNING' &&
        run.status !== 'SUCCEEDED' &&
        run.status !== 'PARTIALLY_SUCCEEDED') ||
      owner.job.status !== 'SUCCEEDED'
    )
      return;
    const task = this.embeddingTasks.get(owner.job.issueId);
    const issue = this.issues.find((item) => item.id === owner.job.issueId);
    if (task === undefined || issue?.publicationStatus !== 'PUBLISHED') return;
    if (task.status !== 'PENDING') return;
    task.status = 'PENDING';
    task.attempts += 1;
    task.lastError = message === undefined ? undefined : safeError(message);
    task.claimToken = undefined;
    task.claimedByProcessExecutionId = undefined;
    task.claimedAt = undefined;
    recomputeEmbeddingPendingCounts(this.runs, this.embeddingTasks, this.issues);
    run.updatedAt = new Date().toISOString();
  }

  async claimPendingEmbeddingTasks(
    limit: number,
    processExecutionId: UuidV7,
    claimToken: UuidV7,
  ): Promise<PipelineEmbeddingTask[]> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100;
    const tasks = [...this.embeddingTasks.values()]
      .filter(
        (task) =>
          task.status === 'PENDING' &&
          this.issues.some(
            (issue) => issue.id === task.issueId && issue.publicationStatus === 'PUBLISHED',
          ),
      )
      .slice(0, safeLimit);
    for (const task of tasks) {
      task.status = 'RUNNING';
      task.claimToken = claimToken;
      task.claimedByProcessExecutionId = processExecutionId;
      task.claimedAt = new Date().toISOString();
      task.attempts += 1;
    }
    recomputeEmbeddingPendingCounts(this.runs, this.embeddingTasks, this.issues);
    return tasks.map((task) => cloneEmbeddingTask(task));
  }

  async listPendingEmbeddingTasks(limit: number): Promise<PipelineEmbeddingTask[]> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100;
    return [...this.embeddingTasks.values()]
      .filter(
        (task) =>
          (task.status === 'PENDING' || task.status === 'RUNNING') &&
          this.issues.some(
            (issue) => issue.id === task.issueId && issue.publicationStatus === 'PUBLISHED',
          ),
      )
      .slice(0, safeLimit)
      .map((task) => cloneEmbeddingTask(task));
  }

  async failEmbeddingTask(taskId: UuidV7, claimToken: UuidV7, message: string): Promise<boolean> {
    const task = [...this.embeddingTasks.values()].find((item) => item.id === taskId);
    const issue =
      task === undefined ? undefined : this.issues.find((item) => item.id === task.issueId);
    if (
      task === undefined ||
      issue?.publicationStatus !== 'PUBLISHED' ||
      task.status !== 'RUNNING' ||
      task.claimToken !== claimToken
    )
      return false;
    task.status = 'PENDING';
    task.lastError = safeError(message);
    task.claimToken = undefined;
    task.claimedByProcessExecutionId = undefined;
    task.claimedAt = undefined;
    recomputeEmbeddingPendingCounts(this.runs, this.embeddingTasks, this.issues);
    return true;
  }

  async releaseEmbeddingClaim(taskId: UuidV7, claimToken: UuidV7): Promise<boolean> {
    const task = [...this.embeddingTasks.values()].find((item) => item.id === taskId);
    if (task === undefined || task.status !== 'RUNNING' || task.claimToken !== claimToken)
      return false;
    task.status = 'PENDING';
    task.claimToken = undefined;
    task.claimedByProcessExecutionId = undefined;
    task.claimedAt = undefined;
    recomputeEmbeddingPendingCounts(this.runs, this.embeddingTasks, this.issues);
    return true;
  }

  async releaseEmbeddingClaims(processExecutionId: UuidV7): Promise<number> {
    let count = 0;
    for (const task of this.embeddingTasks.values()) {
      if (task.status !== 'RUNNING' || task.claimedByProcessExecutionId !== processExecutionId) {
        continue;
      }
      task.status = 'PENDING';
      task.claimToken = undefined;
      task.claimedByProcessExecutionId = undefined;
      task.claimedAt = undefined;
      count += 1;
    }
    if (count > 0) recomputeEmbeddingPendingCounts(this.runs, this.embeddingTasks, this.issues);
    return count;
  }

  async requeueEmbeddingClaims(deadProcessExecutionId: UuidV7): Promise<number> {
    let count = 0;
    for (const task of this.embeddingTasks.values()) {
      if (
        task.status === 'RUNNING' &&
        task.claimedByProcessExecutionId === deadProcessExecutionId &&
        this.issues.some(
          (issue) => issue.id === task.issueId && issue.publicationStatus === 'PUBLISHED',
        )
      ) {
        task.status = 'PENDING';
        task.claimToken = undefined;
        task.claimedByProcessExecutionId = undefined;
        task.claimedAt = undefined;
        count += 1;
      }
    }
    if (count > 0) recomputeEmbeddingPendingCounts(this.runs, this.embeddingTasks, this.issues);
    return count;
  }

  private requireRun(runId: UuidV7): PipelineRunSnapshot {
    const run = this.runs.get(runId);
    if (run === undefined)
      throw new PipelineException(PipelineExceptionCode.RunNotFound, '실행을 찾을 수 없습니다.');
    return run;
  }

  private findJobOwner(
    jobId: UuidV7,
  ): { run: PipelineRunSnapshot; job: PipelineJobRecord } | undefined {
    for (const run of this.runs.values()) {
      const job = run.jobs.find((item) => item.id === jobId);
      if (job !== undefined) return { run, job };
    }
    return undefined;
  }
}

function cloneRun(run: PipelineRunSnapshot): PipelineRunSnapshot {
  return structuredClone(run);
}

function emptyUsageSummary(): PipelineUsageSummary {
  return {
    calls: 0,
    succeededCalls: 0,
    failedCalls: 0,
    unknownCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    actualCost: null,
  };
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function embeddingInputHash(title: string, integratedSummary: string): string {
  return createHash('sha256').update(`${title}\n${integratedSummary}`).digest('hex');
}

function cloneEmbeddingTask(task: PipelineEmbeddingTask): PipelineEmbeddingTask {
  return { ...task };
}

function recomputeEmbeddingPendingCounts(
  runs: Map<UuidV7, PipelineRunSnapshot>,
  tasks: Map<UuidV7, PipelineEmbeddingTask>,
  issues: readonly ExistingIssueSummary[],
): void {
  for (const run of runs.values()) {
    run.embeddingPendingCount = [...tasks.values()].filter(
      (task) =>
        task.runId === run.id &&
        (task.status === 'PENDING' || task.status === 'RUNNING') &&
        issues.some(
          (issue) => issue.id === task.issueId && issue.publicationStatus === 'PUBLISHED',
        ),
    ).length;
  }
}

function safeError(message: string): string {
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

function validateSeedLineage(input: RegisterIssueInput): void {
  if (
    !Array.isArray(input.seedArticles) ||
    input.candidate === null ||
    typeof input.candidate !== 'object' ||
    input.candidate.candidate === null ||
    typeof input.candidate.candidate !== 'object'
  ) {
    throw new PipelineException(
      PipelineExceptionCode.InvalidInput,
      '이슈는 발견된 기사 근거와 함께 등록해야 합니다.',
    );
  }
  const seedIds = input.seedArticles.flatMap((article) =>
    article.id === undefined ? [] : [article.id],
  );
  const sourceIds = input.candidate.candidate.sourceArticleIds;
  if (
    !Array.isArray(sourceIds) ||
    seedIds.length === 0 ||
    sourceIds.length === 0 ||
    seedIds.some((id) => !isUuidV7(id)) ||
    sourceIds.some((id) => !isUuidV7(id)) ||
    new Set(seedIds).size !== seedIds.length ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => !seedIds.includes(id))
  ) {
    throw new PipelineException(
      PipelineExceptionCode.InvalidInput,
      '이슈는 발견된 기사 근거와 함께 등록해야 합니다.',
    );
  }
}
