import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Migration20260915000004FeedAlgorithmSnapshot } from '@newtine/core/pipeline/migrations/Migration20260915000004FeedAlgorithmSnapshot.js';

test('feed algorithm snapshot migration persists bounded session configuration', () => {
  const migration = new Migration20260915000004FeedAlgorithmSnapshot(
    undefined as never,
    undefined as never,
  );
  migration.up();
  const sql = migration.getQueries().join('\n');

  assert.match(sql, /add column if not exists candidate_budget integer/);
  assert.match(sql, /add column if not exists high_score_threshold numeric/);
  assert.match(sql, /alter column candidate_budget set default 100/);
  assert.match(sql, /alter column high_score_threshold set default 0\.7/);
  assert.match(sql, /feed_sessions_candidate_budget_check/);
  assert.match(sql, /feed_sessions_high_score_threshold_check/);
});

test('feed algorithm snapshot migration rejects automatic rollback', () => {
  const migration = new Migration20260915000004FeedAlgorithmSnapshot(
    undefined as never,
    undefined as never,
  );

  assert.throws(() => migration.down(), /intentionally irreversible/);
});
