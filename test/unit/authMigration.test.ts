import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Migration20260914000000Authentication } from '@newtine/core/auth/migrations/Migration20260914000000Authentication.js';

test('인증 migration이 kakao_id를 제거하고 로컬 자격 증명·세션 불변식을 설정한다', () => {
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

test('인증 migration이 credential 데이터의 비가역성 때문에 자동 down migration을 거부한다', () => {
  const migration = new Migration20260914000000Authentication(
    undefined as never,
    undefined as never,
  );

  assert.throws(() => migration.down(), /intentionally irreversible/);
});
