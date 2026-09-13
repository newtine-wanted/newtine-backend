import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  InMemoryPipelineRepository,
  generateUuidV7,
  type ArticleBodyProvider,
  type CandidateClassifier,
  type ContentGenerator,
  type EmbeddingProvider,
  type NewsSearchProvider,
  type SemanticValidator,
} from '@newtine/core';
import { PipelineWorker } from '@newtine/batch/pipeline/pipeline.worker.js';

function logger() {
  return {
    setContext: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as never;
}

test('single worker creates and publishes only after independent evidence validation', async () => {
  const repository = new InMemoryPipelineRepository();
  const firstRun = await repository.enqueue({
    idempotencyKey: 'integration-1',
    requestHash: 'hash-1',
    request: {
      query: '정책',
      limits: {
        discoveryQueries: 1,
        discoveryNews: 20,
        maxCandidates: 5,
        maxNewIssues: 1,
        issueSearchQueries: 2,
        relatedArticlesPerQuery: 10,
        maxBodyAttempts: 5,
        validBodiesTarget: 3,
        transientRetries: 1,
      },
    },
  });
  let searchCalls = 0;
  const search: NewsSearchProvider = {
    search: async () => {
      searchCalls += 1;
      return [
        searchCalls === 1
          ? {
              title: '정책 발표',
              description: '설명',
              sourceUrl: 'https://news.example/1',
              publisherName: 'one',
            }
          : {
              title: '정책 후속',
              description: '설명',
              sourceUrl: 'https://news.example/2',
              publisherName: 'two',
            },
      ];
    },
  };
  const body: ArticleBodyProvider = {
    fetch: async (article) => ({
      articleId: article.id!,
      title: article.title,
      sourceUrl: article.sourceUrl,
      publisherName: article.publisherName,
      body: '확인된 기사 본문 '.repeat(40),
    }),
  };
  const classifier: CandidateClassifier = {
    classify: async ({ articles }) => [
      {
        disposition: 'NEW',
        reason: 'new',
        candidate: {
          title: '정책 이슈',
          scope: '정책 범위',
          confirmedFacts: ['발표'],
          sourceArticleIds: [articles[0]!.id!],
          categoryCode: 'politics',
          searchQueries: ['정책 이슈'],
        },
      },
      {
        disposition: 'NEW',
        reason: 'outside discovery set',
        candidate: {
          title: '잘못된 근거 이슈',
          scope: '정책 범위',
          confirmedFacts: ['발표'],
          sourceArticleIds: [generateUuidV7()],
          categoryCode: 'politics',
          searchQueries: ['잘못된 근거'],
        },
      },
    ],
  };
  const generator: ContentGenerator = {
    generate: async ({ articles }) => ({
      integratedSummary: '정책의 핵심 사실',
      summaryLines: ['사실', '쟁점', '영향'],
      viewpoints: [{ statement: '확인된 주장', articleIds: [articles[0]!.articleId] }],
      glossary: [],
      impacts: [],
    }),
  };
  const validator: SemanticValidator = {
    validate: async ({ articles }) => ({
      status: 'PASS',
      reason: '두 보도로 확인',
      independentEvidenceGroups: [[articles[0]!.articleId], [articles[1]!.articleId]],
      conflicts: [],
    }),
  };
  const embedding: EmbeddingProvider = {
    embed: async () => ({ model: 'text-embedding-3-small', vector: new Array(1_536).fill(0) }),
  };
  const worker = new PipelineWorker(
    repository,
    search,
    body,
    classifier,
    generator,
    validator,
    embedding,
    logger(),
  );
  const executionId = generateUuidV7();
  assert.equal(await worker.runOnce(executionId), true);
  const snapshot = await repository.findById(firstRun.id);
  assert.equal(snapshot?.status, 'SUCCEEDED');
  assert.equal(snapshot?.jobs[0]?.status, 'SUCCEEDED');
  assert.equal(snapshot?.embeddingPendingCount, 0);
  assert.equal(snapshot?.candidateCounts.uncertain, 1);
  assert.equal(snapshot?.candidateCounts.created, 1);
  assert.equal(searchCalls, 3);
  await repository.saveJobFailure(
    snapshot!.jobs[0]!.id,
    snapshot!.attempt,
    executionId,
    'UPSTREAM_ERROR',
    'stale failure after success',
  );
  assert.equal((await repository.findById(firstRun.id))?.jobs[0]?.status, 'SUCCEEDED');
});

test('invalid or insufficient article bodies keep the issue unpublished and fail the job', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'integration-2',
    requestHash: 'hash-2',
    request: {
      query: '정책',
      limits: {
        discoveryQueries: 1,
        discoveryNews: 20,
        maxCandidates: 5,
        maxNewIssues: 1,
        issueSearchQueries: 2,
        relatedArticlesPerQuery: 10,
        maxBodyAttempts: 5,
        validBodiesTarget: 3,
        transientRetries: 1,
      },
    },
  });
  const search: NewsSearchProvider = {
    search: async () =>
      [3, 4].map((index) => ({
        title: `정책 발표 ${index}`,
        description: '설명',
        sourceUrl: `https://news.example/${index}`,
        publisherName: 'one',
      })),
  };
  const body: ArticleBodyProvider = {
    fetch: async (article) => ({
      articleId: article.id!,
      title: `${article.title} (다른 기사)`,
      sourceUrl: `${article.sourceUrl}?wrong-article=1`,
      publisherName: article.publisherName,
      body: '확인된 기사 본문 '.repeat(40),
    }),
  };
  const classifier: CandidateClassifier = {
    classify: async ({ articles }) => [
      {
        disposition: 'NEW',
        reason: 'new',
        candidate: {
          title: '정책 이슈',
          scope: '정책 범위',
          confirmedFacts: ['발표'],
          sourceArticleIds: [articles[0]!.id!],
          categoryCode: 'politics',
          searchQueries: ['정책 이슈'],
        },
      },
    ],
  };
  const neverGenerator: ContentGenerator = {
    generate: async () => {
      throw new Error('must not generate');
    },
  };
  const neverValidator: SemanticValidator = {
    validate: async () => {
      throw new Error('must not validate');
    },
  };
  const embedding: EmbeddingProvider = {
    embed: async () => ({ model: 'text-embedding-3-small', vector: [] }),
  };
  const worker = new PipelineWorker(
    repository,
    search,
    body,
    classifier,
    neverGenerator,
    neverValidator,
    embedding,
    logger(),
  );
  await worker.runOnce(generateUuidV7());
  const snapshot = await repository.findById(run.id);
  assert.equal(snapshot?.status, 'FAILED');
  assert.equal(snapshot?.jobs[0]?.status, 'FAILED');
  assert.equal(snapshot?.jobs[0]?.failureKind, 'INSUFFICIENT_EVIDENCE');
});

test('content retry resumes selected jobs without repeating discovery', async () => {
  const repository = new InMemoryPipelineRepository();
  const run = await repository.enqueue({
    idempotencyKey: 'integration-content-retry',
    requestHash: 'hash-content-retry',
    request: {
      query: '정책',
      limits: {
        discoveryQueries: 1,
        discoveryNews: 20,
        maxCandidates: 5,
        maxNewIssues: 1,
        issueSearchQueries: 2,
        relatedArticlesPerQuery: 10,
        maxBodyAttempts: 5,
        validBodiesTarget: 3,
        transientRetries: 1,
      },
    },
  });
  const firstExecutionId = generateUuidV7();
  assert.ok(await repository.claimNext(firstExecutionId));
  const [seed] = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '시드 기사',
      description: '설명',
      sourceUrl: 'https://news.example/content-retry-seed',
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
        title: '콘텐츠 재시도 이슈',
        scope: '정책 범위',
        confirmedFacts: ['발표'],
        sourceArticleIds: [seed!.id!],
        categoryCode: 'politics',
      },
    },
    seedArticles: [seed!],
  });
  assert.equal(registration.outcome, 'created');
  if (registration.outcome !== 'created') throw new Error('registration should create a job');
  const job = registration.job;
  assert.ok(await repository.claimJob(job.id, 1, firstExecutionId));
  await repository.saveJobFailure(
    job.id,
    1,
    firstExecutionId,
    'INSUFFICIENT_EVIDENCE',
    '근거 부족',
  );
  await repository.failRun(run.id, 1, firstExecutionId, 'UPSTREAM_ERROR', '실행 실패');
  const retried = await repository.retry({
    runId: run.id,
    expectedAttempt: 1,
    scope: 'CONTENT',
    failedJobIds: [job.id],
  });
  assert.equal(retried.retryScope, 'CONTENT');
  assert.equal(retried.retryJobIds.length, 1);
  assert.equal(retried.retryJobIds[0], job.id);
  assert.equal(retried.lastError, undefined);

  let searchCalls = 0;
  const search: NewsSearchProvider = {
    search: async (query) => {
      searchCalls += 1;
      return [1, 2].map((index) => ({
        title: `${query} 후속 ${index}`,
        description: '설명',
        sourceUrl: `https://news.example/content-retry-${searchCalls}-${index}`,
        publisherName: `publisher-${index}`,
      }));
    },
  };
  const body: ArticleBodyProvider = {
    fetch: async (article) => ({
      articleId: article.id!,
      title: article.title,
      sourceUrl: article.sourceUrl,
      publisherName: article.publisherName,
      body: '확인된 기사 본문 '.repeat(40),
    }),
  };
  const neverClassifier: CandidateClassifier = {
    classify: async () => {
      throw new Error('content retry must not run discovery classification');
    },
  };
  const generator: ContentGenerator = {
    generate: async ({ articles }) => ({
      integratedSummary: '재확보한 본문 기반 핵심 사실',
      summaryLines: ['사실', '쟁점', '영향'],
      viewpoints: [{ statement: '확인된 주장', articleIds: [articles[0]!.articleId] }],
      glossary: [],
      impacts: [],
    }),
  };
  const validator: SemanticValidator = {
    validate: async ({ articles }) => ({
      status: 'PASS',
      reason: '두 보도로 확인',
      independentEvidenceGroups: [[articles[0]!.articleId], [articles[1]!.articleId]],
      conflicts: [],
    }),
  };
  const embedding: EmbeddingProvider = {
    embed: async () => ({ model: 'text-embedding-3-small', vector: new Array(1_536).fill(0) }),
  };
  const worker = new PipelineWorker(
    repository,
    search,
    body,
    neverClassifier,
    generator,
    validator,
    embedding,
    logger(),
  );
  assert.equal(await worker.runOnce(generateUuidV7()), true);
  const snapshot = await repository.findById(run.id);
  assert.equal(snapshot?.status, 'SUCCEEDED');
  assert.equal(snapshot?.jobs[0]?.status, 'SUCCEEDED');
  assert.equal(searchCalls, 2);
});
