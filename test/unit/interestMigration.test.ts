import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Migration20260915000000InterestPersistence } from '@newtine/core/interest/migrations/Migration20260915000000InterestPersistence.js';

test('interest migration creates append-only interaction storage and lookup indexes', () => {
  const migration = new Migration20260915000000InterestPersistence(
    undefined as never,
    undefined as never,
  );
  migration.up();
  const sql = migration.getQueries().join('\n');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS "user_interaction_events"/);
  assert.match(sql, /user_interaction_events_user_fk/);
  assert.match(sql, /user_interaction_events_issue_fk/);
  assert.match(sql, /event_type.*LIKE.*SKIP.*PASS/s);
  assert.match(sql, /dwell_time.*>= 0/s);
  assert.match(sql, /user_interaction_events_user_issue_created_idx/);
  assert.match(sql, /user_interaction_events_user_created_idx/);
});

test('interest migration refuses an automatic down migration that could erase history', () => {
  const migration = new Migration20260915000000InterestPersistence(
    undefined as never,
    undefined as never,
  );

  assert.throws(() => migration.down(), /append-only/);
});
