import 'reflect-metadata';

import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import { AuthException, AuthExceptionCode, type AuthPrincipal } from '@newtine/core';
import { WithdrawUseCase } from '@newtine/api/auth/application/withdraw.usecase.js';
import { assertEmptyWithdrawalRequest } from '@newtine/api/auth/withdraw.request.js';
import { Migration20260917000000AccountWithdrawal } from '@newtine/core/pipeline/migrations/Migration20260917000000AccountWithdrawal.js';

const userId = '0199f000-0000-7000-8000-000000000001' as AuthPrincipal['userId'];

test('회원탈퇴 요청은 빈 본문과 query만 허용하지 않고 추가 입력을 차단한다', async () => {
  await assert.doesNotReject(() => assertEmptyWithdrawalRequest({ body: {}, query: {} } as never));
  await assert.doesNotReject(() => assertEmptyWithdrawalRequest({} as never));
  for (const request of [
    { body: { password: 'password' }, query: {} },
    { body: [], query: {} },
    { body: {}, query: { userId } },
  ]) {
    await assert.rejects(() => assertEmptyWithdrawalRequest(request as never), BadRequestException);
  }
  await assert.rejects(
    () =>
      assertEmptyWithdrawalRequest({
        body: undefined,
        headers: { 'content-length': '7', 'content-type': 'text/plain' },
        query: {},
      } as never),
    BadRequestException,
  );
  await assert.doesNotReject(() =>
    assertEmptyWithdrawalRequest({
      body: undefined,
      headers: { 'transfer-encoding': 'chunked' },
      query: {},
      async *[Symbol.asyncIterator]() {},
    } as never),
  );
  await assert.rejects(
    () =>
      assertEmptyWithdrawalRequest({
        body: undefined,
        headers: { 'transfer-encoding': 'chunked' },
        query: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('payload');
        },
      } as never),
    BadRequestException,
  );
});

test('WithdrawUseCase는 사용자 행이 없으면 401로 바꾸고 일시적 DB 오류는 503으로 바꾼다', async () => {
  const transactionManager = {
    execute: async <T>(work: () => Promise<T>): Promise<T> => work(),
  };
  const missing = new WithdrawUseCase(
    { deleteUser: async () => false } as never,
    transactionManager,
  );
  await assert.rejects(
    missing.execute(userId),
    (error: unknown) =>
      error instanceof AuthException && error.code === AuthExceptionCode.InvalidCredentials,
  );

  const unavailable = new WithdrawUseCase(
    {
      deleteUser: async () => {
        throw Object.assign(new Error('lock timeout'), { code: '55P03' });
      },
    } as never,
    transactionManager,
  );
  await assert.rejects(unavailable.execute(userId), ServiceUnavailableException);
});

test('회원탈퇴 migration은 고아 행을 먼저 검증하고 회원 FK를 cascade로 재생성한다', () => {
  const migration = new Migration20260917000000AccountWithdrawal(
    undefined as never,
    undefined as never,
  );
  migration.up();
  const sql = migration.getQueries().join('\n');

  assert.match(sql, /orphaned user_region_preferences/i);
  assert.match(sql, /orphaned member feed_sessions/i);
  assert.match(sql, /unexpected users foreign key/i);
  assert.match(sql, /confdeltype/);
  assert.match(sql, /requires the existing validated user_region_preferences user_id FK/i);
  assert.match(sql, /user_region_preferences_user_fk[\s\S]*on delete cascade/i);
  assert.match(sql, /feed_sessions_user_fk[\s\S]*on delete cascade/i);
  assert.match(sql, /confdeltype = 'n'[\s\S]*weekly_report_id/i);
  assert.match(sql, /session\.user_id is not null/i);
  assert.throws(() => migration.down(), /intentionally irreversible/);
});
