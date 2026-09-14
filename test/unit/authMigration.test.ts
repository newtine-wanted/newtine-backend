import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Migration20260914000000Authentication } from '@newtine/core/auth/migrations/Migration20260914000000Authentication.js';

test('authentication migration removes kakao_id and establishes local credential/session invariants', () => {
  const migration = new Migration20260914000000Authentication(
    undefined as never,
    undefined as never,
  );
  migration.up();
  const sql = migration.getQueries().join('\n');

  assert.match(sql, /DROP COLUMN IF EXISTS "kakao_id"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "password_hash" text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "role" text/);
  assert.match(sql, /users_role_check/);
  assert.match(sql, /users_email_canonical_unique/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "refresh_sessions"/);
  assert.match(sql, /refresh_sessions_user_fk/);
});

test('authentication migration refuses an automatic down migration because credential data is irreversible', () => {
  const migration = new Migration20260914000000Authentication(
    undefined as never,
    undefined as never,
  );

  assert.throws(() => migration.down(), /intentionally irreversible/);
});
