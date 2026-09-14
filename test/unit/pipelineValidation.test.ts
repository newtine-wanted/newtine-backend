import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  InMemoryPipelineRepository,
  PipelineException,
  PipelineExceptionCode,
  PipelineRunService,
  generateUuidV7,
  normalizePipelineLimits,
  normalizePipelineArticleUrl,
  pipelineExternalException,
  validateGeneratedContent,
  validateSemanticResult,
  type FetchedArticle,
  type GeneratedIssueContent,
  type SemanticValidationResult,
} from '@newtine/core';

function fetched(
  ids: [ReturnType<typeof generateUuidV7>, ReturnType<typeof generateUuidV7>],
): FetchedArticle[] {
  return ids.map((articleId, index) => ({
    articleId,
    title: `기사 ${index + 1}`,
    sourceUrl: `https://example.com/${index + 1}`,
    publisherName: `publisher-${index + 1}`,
    body: '본문 '.repeat(100),
  }));
}

function content(
  articleIds: [ReturnType<typeof generateUuidV7>, ReturnType<typeof generateUuidV7>],
): GeneratedIssueContent {
  return {
    integratedSummary: '핵심 사실을 설명하는 한 문장',
    summaryLines: ['첫째', '둘째', '셋째'],
    viewpoints: [{ statement: '확인된 주장', articleIds: [articleIds[0]] }],
    glossary: [],
    impacts: [],
  };
}

test('normalizePipelineLimits applies the agreed initial caps', () => {
  assert.deepEqual(normalizePipelineLimits(), {
    discoveryQueries: 1,
    discoveryNews: 20,
    maxCandidates: 5,
    maxNewIssues: 3,
    issueSearchQueries: 2,
    relatedArticlesPerQuery: 10,
    maxBodyAttempts: 5,
    validBodiesTarget: 3,
    transientRetries: 1,
  });
  assert.throws(() => normalizePipelineLimits({ discoveryNews: 21 }), PipelineException);
  assert.throws(() => normalizePipelineLimits({ validBodiesTarget: 1 }), PipelineException);
  assert.throws(() => normalizePipelineLimits({ maxBodyAttempts: 2 }), PipelineException);
  assert.throws(
    () => normalizePipelineLimits({ maxBodyAttempts: 2, validBodiesTarget: 3 }),
    PipelineException,
  );
});

test('external pipeline failures use the pipeline domain exception boundary', () => {
  const cause = new Error('provider detail stays in the cause chain');
  const exception = pipelineExternalException(PipelineExceptionCode.UpstreamError, {
    retryable: true,
    cause,
  });

  assert.ok(exception instanceof PipelineException);
  assert.equal(exception.domain, 'pipeline');
  assert.equal(exception.code, PipelineExceptionCode.UpstreamError);
  assert.equal(exception.retryable, true);
  assert.equal(exception.message, '외부 공급자 처리 중 오류가 발생했습니다.');
  assert.equal(exception.cause, cause);
});

test('server content validation rejects references outside the fetched input', () => {
  const ids = [generateUuidV7(), generateUuidV7()] as [
    ReturnType<typeof generateUuidV7>,
    ReturnType<typeof generateUuidV7>,
  ];
  const unknownId = generateUuidV7();
  const result = validateGeneratedContent(
    { ...content(ids), viewpoints: [{ statement: '잘못된 주장', articleIds: [unknownId] }] },
    fetched(ids),
  );
  assert.equal(result.ok, false);
});

test('semantic validation requires two independent evidence groups', () => {
  const ids = [generateUuidV7(), generateUuidV7()] as [
    ReturnType<typeof generateUuidV7>,
    ReturnType<typeof generateUuidV7>,
  ];
  const articles = fetched(ids);
  const pass: SemanticValidationResult = {
    status: 'PASS',
    reason: 'ok',
    independentEvidenceGroups: [[ids[0]], [ids[1]]],
    conflicts: [],
  };
  const fail: SemanticValidationResult = {
    status: 'PASS',
    reason: 'not enough',
    independentEvidenceGroups: [[ids[0]]],
    conflicts: [],
  };
  assert.equal(validateSemanticResult(pass, articles).ok, true);
  assert.equal(validateSemanticResult(fail, articles).ok, false);
  assert.equal(
    validateSemanticResult({ ...pass, conflicts: ['상충하는 사실'] }, articles).ok,
    false,
  );
});

test('run service is idempotent and rejects a second active run', async () => {
  const repository = new InMemoryPipelineRepository();
  const service = new PipelineRunService(repository);
  const first = await service.enqueue({ idempotencyKey: 'request-1', query: '정책' });
  const replay = await service.enqueue({ idempotencyKey: 'request-1', query: '정책' });
  assert.equal(replay.id, first.id);
  await assert.rejects(
    () => service.enqueue({ idempotencyKey: 'request-2', query: '다른 정책' }),
    (error: unknown) =>
      error instanceof PipelineException && error.code === 'PIPELINE_ACTIVE_RUN_CONFLICT',
  );
});

test('run service rejects a stale manual retry attempt', async () => {
  const repository = new InMemoryPipelineRepository();
  const service = new PipelineRunService(repository);
  const first = await service.enqueue({ idempotencyKey: 'request-1', query: '정책' });
  await repository.claimNext(generateUuidV7());
  await repository.failRun(
    first.id,
    1,
    (await repository.findById(first.id))!.executionId!,
    'UPSTREAM_ERROR',
    'failed',
  );
  const retried = await service.retry({ runId: first.id, expectedAttempt: 1, scope: 'DISCOVERY' });
  assert.equal(retried.attempt, 2);
  await assert.rejects(
    () => service.retry({ runId: first.id, expectedAttempt: 1, scope: 'DISCOVERY' }),
    (error: unknown) =>
      error instanceof PipelineException && error.code === 'PIPELINE_STALE_ATTEMPT',
  );
});

test('run service rejects an explicitly empty retry job list', async () => {
  const repository = new InMemoryPipelineRepository();
  const service = new PipelineRunService(repository);
  const run = await service.enqueue({ idempotencyKey: 'empty-retry-jobs', query: '정책' });

  await assert.rejects(
    () =>
      service.retry({
        runId: run.id,
        expectedAttempt: 1,
        scope: 'DISCOVERY',
        failedJobIds: [],
      }),
    (error: unknown) =>
      error instanceof PipelineException && error.code === PipelineExceptionCode.InvalidInput,
  );
});

test('run service rejects CONTENT retry without an explicit failed job list before mutation', async () => {
  const repository = new InMemoryPipelineRepository();
  const service = new PipelineRunService(repository);
  const run = await service.enqueue({
    idempotencyKey: 'missing-content-retry-jobs',
    query: '정책',
  });

  await assert.rejects(
    () =>
      service.retry({
        runId: run.id,
        expectedAttempt: 1,
        scope: 'CONTENT',
      } as never),
    (error: unknown) =>
      error instanceof PipelineException && error.code === PipelineExceptionCode.InvalidInput,
  );
  const unchanged = await repository.findById(run.id);
  assert.equal(unchanged?.attempt, 1);
  assert.equal(unchanged?.status, 'QUEUED');
});

test('InMemory repository rejects CONTENT retry without an explicit failed job list', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'in-memory-missing-content-retry-jobs',
    requestHash: 'hash-in-memory-missing-content-retry-jobs',
    request: { query: '정책', limits: normalizePipelineLimits() },
  });

  await assert.rejects(
    () =>
      repository.retry({
        runId: run.id,
        expectedAttempt: 1,
        scope: 'CONTENT',
      } as never),
    (error: unknown) =>
      error instanceof PipelineException && error.code === PipelineExceptionCode.RetryNotAllowed,
  );
  const unchanged = await repository.findById(run.id);
  assert.equal(unchanged?.attempt, 1);
  assert.equal(unchanged?.status, 'QUEUED');
});

test('issue registration requires a valid category and discovered seed lineage', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'registration-lineage',
    requestHash: 'hash-registration-lineage',
    request: { query: '정책', limits: normalizePipelineLimits() },
  });
  const candidate = {
    disposition: 'NEW' as const,
    reason: 'new',
    candidate: {
      title: '근거 없는 이슈',
      scope: '정책',
      confirmedFacts: ['사실'],
      sourceArticleIds: [generateUuidV7()],
      categoryCode: 'politics' as const,
    },
  };
  await assert.rejects(
    () => repository.registerIssue({ runId: run.id, attempt: 1, candidate, seedArticles: [] }),
    (error: unknown) =>
      error instanceof PipelineException && error.code === 'PIPELINE_INVALID_INPUT',
  );
});

test('issue registration rechecks normalized titles and returns a duplicate outcome', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'registration-duplicate',
    requestHash: 'hash-registration-duplicate',
    request: { query: '정책', limits: normalizePipelineLimits() },
  });
  const [article] = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '기사',
      description: '설명',
      sourceUrl: 'https://example.com/registration-duplicate',
      publisherName: 'one',
    },
  ]);
  const candidate = {
    disposition: 'NEW' as const,
    reason: 'new',
    candidate: {
      title: '  같은   이슈  ',
      scope: '정책',
      confirmedFacts: ['사실'],
      sourceArticleIds: [article!.id!],
      categoryCode: 'politics' as const,
    },
  };
  const first = await repository.registerIssue({
    runId: run.id,
    attempt: 1,
    candidate,
    seedArticles: [article!],
  });
  assert.equal(first.outcome, 'created');
  const second = await repository.registerIssue({
    runId: run.id,
    attempt: 1,
    candidate: { ...candidate, candidate: { ...candidate.candidate, title: '같은 이슈' } },
    seedArticles: [article!],
  });
  assert.deepEqual(second, { outcome: 'duplicate' });
  assert.equal((await repository.findById(run.id))?.jobs.length, 1);
});

test('article URL duplicate comparison normalizes provider variants without overwriting the raw URL', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'article-url-normalization',
    requestHash: 'hash-article-url-normalization',
    request: { query: '정책', limits: normalizePipelineLimits() },
  });
  const [first] = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '첫 기사',
      description: '설명',
      sourceUrl: 'HTTPS://News.Example:443/policy#section-a',
      publisherName: 'publisher',
    },
  ]);
  const [second] = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '같은 기사',
      description: '새 설명',
      sourceUrl: 'https://news.example/policy#section-b',
      publisherName: 'publisher',
    },
  ]);

  assert.ok(first?.id);
  assert.equal(second?.id, first?.id);
  assert.equal(second?.sourceUrl, first?.sourceUrl);
  assert.equal(second?.title, '같은 기사');
  assert.equal(second?.description, '새 설명');
  assert.equal(
    normalizePipelineArticleUrl(first!.sourceUrl),
    normalizePipelineArticleUrl(second!.sourceUrl),
  );
  assert.notEqual(
    normalizePipelineArticleUrl('https://news.example/policy'),
    normalizePipelineArticleUrl('https://news.example/policy/'),
  );
});

test('manual interrupt marks the owned run and unfinished job as retryable', async () => {
  const repository = new InMemoryPipelineRepository();
  const service = new PipelineRunService(repository);
  const run = await service.enqueue({ idempotencyKey: 'interrupt-1', query: '정책' });
  const executionId = generateUuidV7();
  const work = await repository.claimNext(executionId);
  assert.ok(work);
  const [article] = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '기사',
      description: '설명',
      sourceUrl: 'https://example.com/interrupt',
      publisherName: 'one',
    },
  ]);
  const registration = await repository.registerIssue({
    runId: run.id,
    attempt: 1,
    candidate: {
      disposition: 'NEW',
      reason: 'new',
      candidate: {
        title: '중단 이슈',
        scope: '정책',
        confirmedFacts: ['사실'],
        sourceArticleIds: [article!.id!],
        categoryCode: 'politics',
      },
    },
    seedArticles: [article!],
  });
  assert.equal(registration.outcome, 'created');
  if (registration.outcome !== 'created') throw new Error('registration should create a job');
  const job = registration.job;
  assert.ok(await repository.claimJob(job.id, 1, executionId));
  const interrupted = await service.interrupt({
    runId: run.id,
    expectedAttempt: 1,
    executionId,
  });
  assert.equal(interrupted.status, 'FAILED');
  assert.equal(interrupted.jobs[0]?.failureKind, 'INTERRUPTED');
  const retried = await service.retry({
    runId: run.id,
    expectedAttempt: 1,
    scope: 'CONTENT',
    failedJobIds: [job.id],
  });
  assert.equal(retried.attempt, 2);
  assert.equal(retried.jobs[0]?.status, 'QUEUED');
});

test('discovery retry does not silently replay content failures', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'discovery-retry-scope',
    requestHash: 'hash-discovery-retry-scope',
    request: { query: '정책', limits: normalizePipelineLimits() },
  });
  const executionId = generateUuidV7();
  assert.ok(await repository.claimNext(executionId));
  const [article] = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '기사',
      description: '설명',
      sourceUrl: 'https://example.com/discovery-retry-scope',
      publisherName: 'one',
    },
  ]);
  const registration = await repository.registerIssue({
    runId: run.id,
    attempt: 1,
    candidate: {
      disposition: 'NEW',
      reason: 'new',
      candidate: {
        title: '재시도 범위 이슈',
        scope: '정책',
        confirmedFacts: ['사실'],
        sourceArticleIds: [article!.id!],
        categoryCode: 'politics',
      },
    },
    seedArticles: [article!],
  });
  assert.equal(registration.outcome, 'created');
  if (registration.outcome !== 'created') throw new Error('registration should create a job');
  const job = registration.job;
  assert.ok(await repository.claimJob(job.id, 1, executionId));
  await repository.saveJobFailure(job.id, 1, executionId, 'INSUFFICIENT_EVIDENCE', '근거 부족');
  await repository.failRun(run.id, 1, executionId, 'UPSTREAM_ERROR', '실행 실패');

  const retried = await repository.retry({
    runId: run.id,
    expectedAttempt: 1,
    scope: 'DISCOVERY',
  });
  assert.equal(retried.attempt, 2);
  assert.equal(retried.jobs[0]?.status, 'FAILED');
  assert.equal(retried.jobs[0]?.attempt, 1);
  await assert.rejects(
    () =>
      repository.retry({
        runId: run.id,
        expectedAttempt: 2,
        scope: 'CONTENT',
        failedJobIds: [job.id],
      }),
    (error: unknown) =>
      error instanceof PipelineException && error.code === 'PIPELINE_RETRY_NOT_ALLOWED',
  );
});

test('usage metadata is accumulated on the run snapshot', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'usage-summary',
    requestHash: 'hash-usage-summary',
    request: { query: '정책', limits: normalizePipelineLimits() },
  });
  await repository.recordUsage({
    runId: run.id,
    runAttempt: 1,
    operation: 'LLM',
    purpose: 'test',
    provider: 'openai',
    model: 'test-model',
    status: 'SUCCEEDED',
    requestId: 'req-1',
    inputTokens: 12,
    outputTokens: 7,
    actualCost: 0.01,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
  });
  await repository.recordUsage({
    runId: run.id,
    runAttempt: 1,
    operation: 'FETCH',
    purpose: 'test',
    provider: 'naver',
    status: 'UNKNOWN',
    startedAt: new Date(0).toISOString(),
  });
  const snapshot = await repository.findById(run.id);
  assert.equal(snapshot?.usageSummary.calls, 2);
  assert.equal(snapshot?.usageSummary.succeededCalls, 1);
  assert.equal(snapshot?.usageSummary.failedCalls, 0);
  assert.equal(snapshot?.usageSummary.unknownCalls, 1);
  assert.equal(snapshot?.usageSummary.inputTokens, 12);
  assert.equal(snapshot?.usageSummary.outputTokens, 7);
  assert.equal(snapshot?.usageSummary.actualCost, 0.01);
});

test('embedding maintenance failures remain visible without reversing content success', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'embedding-pending',
    requestHash: 'hash-embedding-pending',
    request: { query: '정책', limits: normalizePipelineLimits() },
  });
  const executionId = generateUuidV7();
  const work = await repository.claimNext(executionId);
  assert.ok(work);
  const articles = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '첫 기사',
      description: '설명',
      sourceUrl: 'https://example.com/embedding-1',
      publisherName: 'one',
    },
    {
      title: '둘째 기사',
      description: '설명',
      sourceUrl: 'https://example.com/embedding-2',
      publisherName: 'two',
    },
  ]);
  const registration = await repository.registerIssue({
    runId: run.id,
    attempt: 1,
    candidate: {
      disposition: 'NEW',
      reason: 'new',
      candidate: {
        title: '임베딩 이슈',
        scope: '정책',
        confirmedFacts: ['사실'],
        sourceArticleIds: articles.map((article) => article.id!),
        categoryCode: 'politics',
      },
    },
    seedArticles: articles,
  });
  assert.equal(registration.outcome, 'created');
  if (registration.outcome !== 'created') throw new Error('registration should create a job');
  const job = registration.job;
  const claimed = await repository.claimJob(job.id, 1, executionId);
  assert.ok(claimed);
  const content: GeneratedIssueContent = {
    integratedSummary: '핵심 사실',
    summaryLines: ['하나', '둘', '셋'],
    viewpoints: [{ statement: '주장', articleIds: [articles[0]!.id!] }],
    glossary: [],
    impacts: [],
  };
  const validation: SemanticValidationResult = {
    status: 'PASS',
    reason: '두 근거',
    independentEvidenceGroups: [[articles[0]!.id!], [articles[1]!.id!]],
    conflicts: [],
  };
  const evidence = articles.map((article) => ({
    articleId: article.id!,
    title: article.title,
    sourceUrl: article.sourceUrl,
    publisherName: article.publisherName,
    body: '본문',
  }));
  assert.equal(
    await repository.saveJobSuccess(job.id, 1, executionId, content, validation, evidence),
    true,
  );
  await repository.markEmbeddingPending(run.id, 1, executionId, job.id);
  const pending = await repository.findById(run.id);
  assert.equal(pending?.embeddingPendingCount, 1);
  await repository.completeRun(run.id, 1, executionId);
  const completed = await repository.findById(run.id);
  assert.equal(completed?.status, 'SUCCEEDED');
  assert.equal(completed?.embeddingPendingCount, 1);
});

test('in-memory failure handling cannot downgrade a terminal job', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'terminal-failure-guard',
    requestHash: 'hash-terminal-failure-guard',
    request: { query: '정책', limits: normalizePipelineLimits() },
  });
  const executionId = generateUuidV7();
  assert.ok(await repository.claimNext(executionId));
  const [article] = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '기사',
      description: '설명',
      sourceUrl: 'https://example.com/terminal-failure-guard',
      publisherName: 'one',
    },
  ]);
  const registration = await repository.registerIssue({
    runId: run.id,
    attempt: 1,
    candidate: {
      disposition: 'NEW',
      reason: 'new',
      candidate: {
        title: '종료 job',
        scope: '정책',
        confirmedFacts: ['사실'],
        sourceArticleIds: [article!.id!],
        categoryCode: 'politics',
      },
    },
    seedArticles: [article!],
  });
  assert.equal(registration.outcome, 'created');
  if (registration.outcome !== 'created') throw new Error('registration should create a job');
  const job = registration.job;
  assert.ok(await repository.claimJob(job.id, 1, executionId));
  await repository.saveJobFailure(job.id, 1, executionId, 'INSUFFICIENT_EVIDENCE', 'first failure');
  await repository.saveJobFailure(job.id, 1, executionId, 'UPSTREAM_ERROR', 'stale failure');
  const snapshot = await repository.findById(run.id);
  assert.equal(snapshot?.jobs[0]?.status, 'FAILED');
  assert.equal(snapshot?.jobs[0]?.failureKind, 'INSUFFICIENT_EVIDENCE');
  assert.equal(snapshot?.jobs[0]?.lastError, 'first failure');
});
