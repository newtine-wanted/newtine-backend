import assert from 'node:assert/strict';
import { EntityManager } from '@mikro-orm/core';
import { test } from '@jest/globals';

import { PostgresIssueQueryRepository } from '@newtine/api/issue/repository/postgresIssueQuery.repository.js';
import type { FeedBatchRecord, FeedSessionRecord, IssueCandidateScope } from '@newtine/core';

const SESSION_ID = '00000000-0000-7000-8000-000000000001';

test('postgres feed batch transaction normalizes a raw get row', async () => {
  const executed: string[] = [];
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      executed.push(sql);
      if (sql.includes('SELECT id, status, next_batch_no')) {
        return {
          id: SESSION_ID,
          status: 'ACTIVE',
          next_batch_no: 0,
          is_unexpired: true,
        };
      }
      if (sql.includes('SELECT 1 FROM feed_batches')) return undefined;
      if (sql.includes('SELECT continuation')) return undefined;
      return {};
    },
  };
  const transactionContext = {
    getConnection: () => connection,
    getTransactionContext: () => ({}),
  };
  const entityManager = {
    getContext: () => transactionContext,
  } as unknown as EntityManager;
  const repository = new PostgresIssueQueryRepository(entityManager);

  await repository.saveFeedBatch(session(), batch(0));

  assert.equal(
    executed.some((sql) => sql.includes('INSERT INTO feed_batches')),
    true,
  );
  assert.equal(
    executed.some((sql) => sql.includes('UPDATE feed_sessions')),
    true,
  );
});

test('postgres feed batch save rejects a session that expires during candidate calculation', async () => {
  const executed: string[] = [];
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      executed.push(sql);
      if (sql.includes('SELECT id, status, next_batch_no')) {
        return {
          id: SESSION_ID,
          status: 'ACTIVE',
          next_batch_no: 0,
          is_unexpired: false,
        };
      }
      return [];
    },
  };
  const transactionContext = {
    getConnection: () => connection,
    getTransactionContext: () => ({}),
  };
  const entityManager = {
    getContext: () => transactionContext,
  } as unknown as EntityManager;
  const repository = new PostgresIssueQueryRepository(entityManager);

  await assert.rejects(repository.saveFeedBatch(session(), batch(0)), /만료/);
  assert.equal(
    executed.some((sql) => sql.includes('INSERT INTO feed_batches')),
    false,
  );
  assert.equal(
    executed.some((sql) => sql.includes('clock_timestamp()')),
    true,
  );
});

test('postgres feed batches bulk-load all items with one item query', async () => {
  const executed: string[] = [];
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      executed.push(sql);
      if (sql.includes('SELECT feed_session_id::text, batch_no, continuation')) {
        return [
          {
            feed_session_id: SESSION_ID,
            batch_no: 0,
            continuation: 'CONTINUE',
            created_at: '2026-01-01T00:00:00.000Z',
          },
          {
            feed_session_id: SESSION_ID,
            batch_no: 1,
            continuation: 'EXHAUSTED',
            created_at: '2026-01-01T00:01:00.000Z',
          },
        ];
      }
      if (sql.includes('SELECT feed_session_id::text, batch_no, issue_id::text')) {
        return [
          {
            feed_session_id: SESSION_ID,
            batch_no: 0,
            issue_id: '00000000-0000-7000-8000-000000000010',
            position: 1,
            selection_type: 'MAJOR',
            reason_codes: ['MAJOR_SCORE'],
          },
          {
            feed_session_id: SESSION_ID,
            batch_no: 1,
            issue_id: '00000000-0000-7000-8000-000000000011',
            position: 1,
            selection_type: 'EXPLORATION',
            reason_codes: [],
          },
        ];
      }
      return [];
    },
  };
  const entityManager = {
    getContext: () => ({
      getConnection: () => connection,
      getTransactionContext: () => undefined,
    }),
  } as unknown as EntityManager;
  const repository = new PostgresIssueQueryRepository(entityManager);

  const batches = await repository.findFeedBatches(SESSION_ID);

  assert.deepEqual(
    batches.map((stored) => stored.items.map((item) => item.issueId)),
    [['00000000-0000-7000-8000-000000000010'], ['00000000-0000-7000-8000-000000000011']],
  );
  assert.equal(
    executed.filter((sql) => sql.includes('SELECT feed_session_id::text, batch_no, issue_id::text'))
      .length,
    1,
  );
});

test('postgres issue projection uses canonical columns and available article policy', async () => {
  const executed: string[] = [];
  const issueId = '00000000-0000-7000-8000-000000000020';
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      executed.push(sql);
      if (sql.includes('SELECT i.id::text AS id')) {
        return {
          id: issueId,
          title: '공개 이슈',
          category_code: 'housing',
          category_name: '주거',
          sub_category: null,
          main_topic: null,
          representative_entity_id: null,
          event_at: null,
          publication_status: 'PUBLISHED',
          freshness_score: 0.8,
          importance_score: 0.9,
          published_at: null,
          updated_at: '2026-01-01T00:00:00.000Z',
          integrated_summary: '요약',
          summary_lines: ['첫째', '둘째', '셋째'],
          viewpoints: null,
          glossary: [],
          entity_ids: [],
          region_codes: [],
          age_groups: [],
          article_count: 1,
        };
      }
      if (sql.includes('COALESCE(p.name, a.publisher_name)')) {
        return [
          {
            id: '00000000-0000-7000-8000-000000000021',
            title: '사용 가능한 기사',
            article_url: 'https://example.com/available',
            publisher_name: '테스트 언론',
            published_at: null,
          },
        ];
      }
      return [];
    },
  };
  const entityManager = {
    getContext: () => ({
      getConnection: () => connection,
      getTransactionContext: () => undefined,
    }),
  } as unknown as EntityManager;
  const repository = new PostgresIssueQueryRepository(entityManager);

  const issue = await repository.findIssue(issueId);

  assert.equal(issue?.categoryName, '주거');
  assert.equal(issue?.articles.length, 1);
  assert.equal(
    executed.some((sql) => sql.includes('c.display_name AS category_name')),
    true,
  );
  assert.equal(
    executed.some((sql) => sql.includes("count_article.source_status = 'AVAILABLE'")),
    true,
  );
  assert.equal(
    executed.some((sql) => sql.includes("a.source_status = 'AVAILABLE'")),
    true,
  );
  assert.equal(
    executed.some(
      (sql) => sql.includes('i.main_topic') || sql.includes('i.representative_entity_id'),
    ),
    false,
  );
});

test('postgres candidate arrays bind each value as a scalar parameter', async () => {
  const executions: Array<{ sql: string; params: unknown[] }> = [];
  const connection = {
    execute: async (sql: string, params: unknown[]): Promise<unknown> => {
      executions.push({ sql, params });
      return [];
    },
  };
  const entityManager = {
    getContext: () => ({
      getConnection: () => connection,
      getTransactionContext: () => undefined,
    }),
  } as unknown as EntityManager;
  const repository = new PostgresIssueQueryRepository(entityManager);
  const scope: IssueCandidateScope = {
    highScoreThreshold: 0.8,
    selectedCategoryCodes: ['housing'],
    selectedEntityIds: ['00000000-0000-7000-8000-000000000030'],
    preferredRegionCodes: ['SEOUL'],
    ageGroup: 'AGE_19_34',
    actedCategoryCodes: ['finance'],
    connectedIssueIds: ['00000000-0000-7000-8000-000000000031'],
  };

  await repository.findCandidates(new Set(['00000000-0000-7000-8000-000000000032']), 10, scope);

  assert.equal(executions.length > 0, true);
  assert.equal(
    executions.every(({ params }) => params.every((param) => !Array.isArray(param))),
    true,
  );
  assert.equal(
    executions.some(({ sql }) => sql.includes('ARRAY[?::text]::text[]')),
    true,
  );
  assert.equal(
    executions.some(({ sql }) => sql.includes('ARRAY[?::uuid]::uuid[]')),
    true,
  );
});

function session(): FeedSessionRecord {
  return {
    id: SESSION_ID,
    owner: { userId: null, guestKey: 'guest-hash' },
    algorithmVersion: 'issue-card-query-v1',
    nextBatchNo: 1,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    lastTopic: null,
    lastRepresentativeEntityId: null,
    topicRun: 0,
    entityRun: 0,
  };
}

function batch(batchNo: number): FeedBatchRecord {
  return {
    sessionId: SESSION_ID,
    batchNo,
    items: [],
    continuation: 'CONTINUE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
