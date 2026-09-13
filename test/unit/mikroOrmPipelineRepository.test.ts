import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  MikroOrmPipelineRepository,
  PipelineException,
  PipelineExceptionCode,
  generateUuidV7,
} from '@newtine/core';

test('MikroORM issue registration passes the transaction context to every raw query', async () => {
  const runId = generateUuidV7();
  const articleId = generateUuidV7();
  const transactionContext = {};
  const calls: Array<{ query: string; context: unknown }> = [];
  const connection = {
    execute: async (query: string, _params?: unknown[], _method?: unknown, context?: unknown) => {
      calls.push({ query, context });
      if (query.startsWith('select id, status, attempt')) {
        return [{ id: runId, status: 'QUEUED', attempt: 1 }];
      }
      return [];
    },
  };
  const transactionalEntityManager = {
    getConnection: () => connection,
    getTransactionContext: () => transactionContext,
  };
  const entityManager = {
    transactional: async (callback: (em: typeof transactionalEntityManager) => Promise<unknown>) =>
      callback(transactionalEntityManager),
  };
  const repository = new MikroOrmPipelineRepository(entityManager as never);

  const result = await repository.registerIssue({
    runId,
    attempt: 1,
    candidate: {
      disposition: 'NEW',
      reason: 'new',
      candidate: {
        title: '새 이슈',
        scope: '정책',
        confirmedFacts: ['사실'],
        sourceArticleIds: [articleId],
        categoryCode: 'politics',
      },
    },
    seedArticles: [
      {
        id: articleId,
        title: '기사',
        description: '설명',
        sourceUrl: 'https://example.com/article',
        publisherName: 'publisher',
      },
    ],
  });

  assert.equal(result.outcome, 'created');
  assert.ok(calls.length >= 5);
  assert.ok(calls.every((call) => call.context === transactionContext));
});

test('MikroORM retry rejects an explicitly empty failed job list', async () => {
  const runId = generateUuidV7();
  const calls: string[] = [];
  const connection = {
    execute: async (query: string) => {
      calls.push(query);
      if (query === 'select * from pipeline_runs where id = $1 for update') {
        return [{ id: runId, status: 'FAILED', attempt: 1 }];
      }
      return [];
    },
  };
  const transactionalEntityManager = {
    getConnection: () => connection,
    getTransactionContext: () => ({}),
  };
  const entityManager = {
    transactional: async (callback: (em: typeof transactionalEntityManager) => Promise<unknown>) =>
      callback(transactionalEntityManager),
  };
  const repository = new MikroOrmPipelineRepository(entityManager as never);

  await assert.rejects(
    () =>
      repository.retry({
        runId,
        expectedAttempt: 1,
        scope: 'DISCOVERY',
        failedJobIds: [],
      }),
    (error: unknown) =>
      error instanceof PipelineException && error.code === PipelineExceptionCode.RetryNotAllowed,
  );
  assert.deepEqual(calls, ['select * from pipeline_runs where id = $1 for update']);
});

test('MikroORM repository rejects CONTENT retry without a failed job list before opening a transaction', async () => {
  const runId = generateUuidV7();
  let transactionalCalled = false;
  const entityManager = {
    transactional: async () => {
      transactionalCalled = true;
      throw new Error('transaction should not be opened');
    },
  };
  const repository = new MikroOrmPipelineRepository(entityManager as never);

  await assert.rejects(
    () =>
      repository.retry({
        runId,
        expectedAttempt: 1,
        scope: 'CONTENT',
      } as never),
    (error: unknown) =>
      error instanceof PipelineException && error.code === PipelineExceptionCode.RetryNotAllowed,
  );
  assert.equal(transactionalCalled, false);
});

test('MikroORM CONTENT retry updates only the explicitly selected failed job IDs', async () => {
  const runId = generateUuidV7();
  const selectedJobId = generateUuidV7();
  const runRow = {
    id: runId,
    idempotency_key: 'retry-content-test',
    request_hash: 'request-hash',
    request_json: JSON.stringify({ query: '정책', limits: {} }),
    status: 'FAILED',
    attempt: 1,
    candidate_counts: JSON.stringify({
      discovered: 0,
      duplicate: 0,
      uncertain: 0,
      created: 0,
      skippedByLimit: 0,
    }),
    retry_scope: null,
    retry_job_ids: JSON.stringify([]),
    execution_id: null,
    current_stage: null,
    last_error: 'previous failure',
    started_at: null,
    finished_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const updatedRunRow = {
    ...runRow,
    status: 'QUEUED',
    attempt: 2,
    retry_scope: 'CONTENT',
    retry_job_ids: JSON.stringify([selectedJobId]),
    last_error: null,
  };
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const connection = {
    execute: async (query: string, params?: unknown[]) => {
      calls.push({ query, params: params ?? [] });
      if (query === 'select * from pipeline_runs where id = $1 for update') return [runRow];
      if (query.includes('select j.id, j.status')) {
        return [{ id: selectedJobId, status: 'FAILED', publication_status: 'PUBLISHED' }];
      }
      if (query.includes("status in ('QUEUED', 'RUNNING')")) return [];
      if (query.startsWith("update pipeline_runs set status = 'QUEUED'")) {
        return [{ id: runId }];
      }
      if (query.startsWith("update issue_content_jobs set status = 'QUEUED'")) return [];
      if (query === 'select * from pipeline_runs where id = $1 limit 1') return [updatedRunRow];
      if (query.startsWith('select * from issue_content_jobs')) return [];
      if (query.includes('from ai_usage_records')) {
        return [
          {
            calls: 0,
            succeeded_calls: 0,
            failed_calls: 0,
            unknown_calls: 0,
            input_tokens: 0,
            output_tokens: 0,
            actual_cost: null,
          },
        ];
      }
      if (query.includes('from issue_embedding_tasks')) return [{ count: 0 }];
      return [];
    },
  };
  const transactionalEntityManager = {
    getConnection: () => connection,
    getTransactionContext: () => ({}),
  };
  const entityManager = {
    transactional: async (callback: (em: typeof transactionalEntityManager) => Promise<unknown>) =>
      callback(transactionalEntityManager),
    getConnection: () => connection,
  };
  const repository = new MikroOrmPipelineRepository(entityManager as never);

  const result = await repository.retry({
    runId,
    expectedAttempt: 1,
    scope: 'CONTENT',
    failedJobIds: [selectedJobId],
  });

  assert.equal(result.status, 'QUEUED');
  assert.equal(result.attempt, 2);
  assert.deepEqual(result.retryJobIds, [selectedJobId]);
  const runUpdate = calls.find((call) =>
    call.query.startsWith("update pipeline_runs set status = 'QUEUED'"),
  );
  assert.deepEqual(runUpdate?.params, [runId, 2, 'CONTENT', JSON.stringify([selectedJobId])]);
  const jobUpdate = calls.find((call) =>
    call.query.startsWith("update issue_content_jobs set status = 'QUEUED'"),
  );
  assert.deepEqual(jobUpdate?.params, [runId, 2, [selectedJobId]]);
});

test('MikroORM embedding repair uses an atomic claim query and maps immutable run provenance', async () => {
  const taskId = generateUuidV7();
  const runId = generateUuidV7();
  const jobId = generateUuidV7();
  const runExecutionId = generateUuidV7();
  const processExecutionId = generateUuidV7();
  const claimToken = generateUuidV7();
  const transactionContext = {};
  const calls: Array<{ query: string; params: unknown[]; context: unknown }> = [];
  const connection = {
    execute: async (query: string, params?: unknown[], _method?: unknown, context?: unknown) => {
      calls.push({ query, params: params ?? [], context });
      if (query.startsWith('with candidates as')) {
        return [
          {
            id: taskId,
            issue_id: generateUuidV7(),
            pipeline_run_id: runId,
            issue_content_job_id: jobId,
            run_attempt: 2,
            run_execution_id: runExecutionId,
            input_hash: 'hash',
            model: 'text-embedding-3-small',
            status: 'RUNNING',
            attempt_count: 1,
            last_error: null,
            claim_token: claimToken,
            claimed_by_process_execution_id: processExecutionId,
            claimed_at: new Date().toISOString(),
            title: '제목',
            integrated_summary: '요약',
          },
        ];
      }
      return [];
    },
  };
  const transactionalEntityManager = {
    getConnection: () => connection,
    getTransactionContext: () => transactionContext,
  };
  const entityManager = {
    transactional: async (callback: (em: typeof transactionalEntityManager) => Promise<unknown>) =>
      callback(transactionalEntityManager),
  };
  const repository = new MikroOrmPipelineRepository(entityManager as never);

  const tasks = await repository.claimPendingEmbeddingTasks(10, processExecutionId, claimToken);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.id, taskId);
  assert.equal(tasks[0]?.runExecutionId, runExecutionId);
  assert.equal(tasks[0]?.claimedByProcessExecutionId, processExecutionId);
  assert.equal(tasks[0]?.claimToken, claimToken);
  assert.match(calls[0]?.query ?? '', /for update of t skip locked/);
  assert.ok(calls.every((call) => call.context === transactionContext));
});

test('MikroORM embedding completion rejects a stale claim before writing the vector', async () => {
  const issueId = generateUuidV7();
  const taskId = generateUuidV7();
  const activeClaimToken = generateUuidV7();
  const transactionContext = {};
  const calls: string[] = [];
  const connection = {
    execute: async (query: string) => {
      calls.push(query);
      if (query.startsWith('select id, input_hash')) {
        return [
          {
            id: taskId,
            input_hash: 'different-hash',
            model: 'text-embedding-3-small',
            status: 'RUNNING',
            claim_token: activeClaimToken,
          },
        ];
      }
      return [];
    },
  };
  const transactionalEntityManager = {
    getConnection: () => connection,
    getTransactionContext: () => transactionContext,
  };
  const entityManager = {
    transactional: async (callback: (em: typeof transactionalEntityManager) => Promise<unknown>) =>
      callback(transactionalEntityManager),
  };
  const repository = new MikroOrmPipelineRepository(entityManager as never);

  const result = await repository.saveEmbedding(
    issueId,
    '제목',
    '요약',
    new Array(1_536).fill(0),
    'text-embedding-3-small',
    taskId,
    generateUuidV7(),
    'text-embedding-3-small',
  );

  assert.equal(result, 'STALE');
  assert.equal(
    calls.some((query) => query.startsWith('insert into issue_embeddings')),
    false,
  );
});

test('MikroORM embedding failure requeues only the matching claim token', async () => {
  const taskId = generateUuidV7();
  const claimToken = generateUuidV7();
  const transactionContext = {};
  const calls: Array<{ query: string; context: unknown }> = [];
  const connection = {
    execute: async (query: string, _params?: unknown[], _method?: unknown, context?: unknown) => {
      calls.push({ query, context });
      if (query.startsWith('update issue_embedding_tasks set status =')) return [{ id: taskId }];
      return [];
    },
  };
  const transactionalEntityManager = {
    getConnection: () => connection,
    getTransactionContext: () => transactionContext,
  };
  const entityManager = {
    transactional: async (callback: (em: typeof transactionalEntityManager) => Promise<unknown>) =>
      callback(transactionalEntityManager),
  };
  const repository = new MikroOrmPipelineRepository(entityManager as never);

  assert.equal(await repository.failEmbeddingTask(taskId, claimToken, 'provider failed'), true);
  assert.match(calls[0]?.query ?? '', /claim_token = \$2/);
  assert.ok(calls.every((call) => call.context === transactionContext));
});
