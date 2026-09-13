import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { InMemoryIssueQueryRepository } from '@newtine/api/issue/repository/inMemoryIssueQuery.repository.js';
import type { FeedBatchRecord, FeedSessionRecord } from '@newtine/core';

test('in-memory feed batch save keeps the first concurrent write', async () => {
  const repository = new InMemoryIssueQueryRepository();
  const session = await repository.createFeedSession(
    { userId: null, guestKey: 'guest-hash' },
    new Date('2026-01-01T00:00:00.000Z'),
  );
  const first = batch(session, 'first');
  const second = batch(session, 'second');

  await Promise.all([
    repository.saveFeedBatch(session, first),
    repository.saveFeedBatch(session, second),
  ]);

  const stored = await repository.findFeedBatch(session.id, 0);
  assert.equal(stored?.items[0]?.reasonCodes[0], 'first');
});

function batch(session: FeedSessionRecord, reason: string): FeedBatchRecord {
  return {
    sessionId: session.id,
    batchNo: 0,
    items: [
      {
        issueId: '00000000-0000-7000-8000-000000000010',
        position: 1,
        selectionType: 'MAJOR',
        reasonCodes: [reason],
      },
    ],
    continuation: 'CONTINUE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
