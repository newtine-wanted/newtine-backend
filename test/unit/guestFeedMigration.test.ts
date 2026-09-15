import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Migration20260915000002GuestFeed } from '@newtine/core/pipeline/migrations/Migration20260915000002GuestFeed.js';

test('guest feed migration restores an explicit member-or-guest owner constraint', () => {
  const migration = new Migration20260915000002GuestFeed(undefined as never, undefined as never);
  migration.up();
  const sql = migration.getQueries().join('\n');

  assert.match(sql, /add column if not exists guest_token_hash text/);
  assert.match(sql, /alter column user_id drop not null/);
  assert.match(sql, /feed_sessions_owner_check/);
  assert.match(sql, /feed_sessions_guest_token_hash_check/);
  assert.match(sql, /invalid guest token hash/);
  assert.match(sql, /exactly one owner/);
  assert.match(sql, /feed_sessions_member_active_idx/);
  assert.match(sql, /feed_sessions_guest_active_idx/);
});

test('guest feed migration rejects automatic rollback', () => {
  const migration = new Migration20260915000002GuestFeed(undefined as never, undefined as never);

  assert.throws(() => migration.down(), /intentionally irreversible/);
});
