import assert from 'node:assert/strict';
import { EntityManager } from '@mikro-orm/core';
import { test } from '@jest/globals';

import { PostgresIssueQueryRepository } from '@newtine/api/issue/repository/postgresIssueQuery.repository.js';
import type { FeedBatchRecord, FeedSessionRecord } from '@newtine/core';

const SESSION_ID = '00000000-0000-7000-8000-000000000001';

test('postgres feed batch transaction normalizes a raw get row', async () => {
  const executed: string[] = [];
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      executed.push(sql);
      if (sql.includes('SELECT id, status, next_batch_no')) {
        return { id: SESSION_ID, status: 'ACTIVE', next_batch_no: 0 };
      }
      if (sql.includes('SELECT 1 FROM feed_batches')) return undefined;
      if (sql.includes('SELECT continuation')) return undefined;
      return {};
    },
  };
  const entityManager = {
    transactional: async (work: (manager: unknown) => Promise<void>) =>
      work({
        getConnection: () => connection,
        getTransactionContext: () => ({}),
      }),
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
