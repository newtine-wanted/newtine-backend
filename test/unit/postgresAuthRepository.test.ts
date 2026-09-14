import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { AuthRole, PostgresAuthRepository, generateUuidV7, type AuthUser } from '@newtine/core';
import { RefreshSessionSchema } from '@newtine/core/auth/persistence/auth.persistence.entity.js';
import { UserSchema } from '@newtine/core/user/persistence/user.persistence.entity.js';

const userId = generateUuidV7();
const sessionId = generateUuidV7();

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: userId,
    email: 'user@example.com',
    passwordHash: 'argon2id-hash',
    role: AuthRole.User,
    ...overrides,
  };
}

test('PostgresAuthRepository가 일반 사용자 CRUD를 ORM metadata로 수행한다', async () => {
  const findCalls: Array<{ entity: unknown; where: unknown }> = [];
  const insertCalls: Array<{ entity: unknown; data: unknown }> = [];
  const updateCalls: Array<{ entity: unknown; where: unknown; data: unknown }> = [];
  const entityManager = createEntityManager({
    findOne: async (entity: unknown, where: unknown) => {
      findCalls.push({ entity, where });
      return {
        id: userId,
        email: 'user@example.com',
        passwordHash: 'argon2id-hash',
        role: 'USER',
        onboardingStatus: 'PENDING',
        onboardingCompletedAt: null,
        ageGroup: null,
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      };
    },
    insert: async (entity: unknown, data: unknown) => {
      insertCalls.push({ entity, data });
    },
    nativeUpdate: async (entity: unknown, where: unknown, data: unknown) => {
      updateCalls.push({ entity, where, data });
      return 1;
    },
  });
  const repository = new PostgresAuthRepository(entityManager as never);

  assert.deepEqual(await repository.findUserByEmail('user@example.com'), authUser());
  assert.deepEqual(await repository.findUserById(userId), authUser());
  await repository.createUser({
    id: userId,
    email: 'user@example.com',
    passwordHash: 'argon2id-hash',
    role: AuthRole.User,
    createdAt: new Date('2026-09-14T12:00:00.000Z'),
  });
  await repository.createRefreshSession({
    id: sessionId,
    userId,
    tokenHash: 'hash',
    expiresAt: new Date('2026-10-14T12:00:00.000Z'),
    createdAt: new Date('2026-09-14T12:00:00.000Z'),
  });
  await repository.revokeRefreshSession('hash', new Date('2026-09-14T12:01:00.000Z'));

  assert.equal(findCalls.length, 2);
  assert.equal(findCalls[0]?.entity, UserSchema);
  const emailWhere = findCalls[0]?.where as Record<PropertyKey, unknown>;
  const emailKey = Reflect.ownKeys(emailWhere)[0];
  assert.equal(typeof emailKey, 'symbol');
  assert.equal(emailWhere[emailKey!], 'user@example.com');
  assert.equal(findCalls[1]?.entity, UserSchema);
  assert.equal(insertCalls.length, 2);
  assert.equal(insertCalls[0]?.entity, UserSchema);
  assert.deepEqual(
    (insertCalls[0]?.data as { onboardingStatus: string }).onboardingStatus,
    'PENDING',
  );
  assert.equal(insertCalls[1]?.entity, RefreshSessionSchema);
  assert.deepEqual((insertCalls[1]?.data as { usedAt: Date | null }).usedAt, null);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.entity, RefreshSessionSchema);
  assert.deepEqual(updateCalls[0]?.where, { tokenHash: 'hash', usedAt: null, revokedAt: null });
});

test('PostgresAuthRepository가 refresh rotation의 잠금·소비만 명시적 SQL로 수행한다', async () => {
  const sqlCalls: Array<{ sql: string; params: unknown[]; method: string }> = [];
  const insertCalls: Array<{ entity: unknown; data: unknown }> = [];
  const findCalls: Array<{ entity: unknown; where: unknown }> = [];
  const now = new Date('2026-09-14T12:00:00.000Z');
  const connection = {
    execute: async (sql: string, params: unknown[] = [], method = 'run'): Promise<unknown> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      sqlCalls.push({ sql: normalized, params, method });
      if (normalized.includes('FROM refresh_sessions')) {
        return {
          id: sessionId,
          user_id: userId,
          expires_at: new Date('2026-10-14T12:00:00.000Z'),
          used_at: null,
          revoked_at: null,
        };
      }
      if (normalized.startsWith('UPDATE refresh_sessions')) return { affectedRows: 1 };
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
  const entityManager = createEntityManager({
    connection,
    insert: async (entity: unknown, data: unknown) => {
      insertCalls.push({ entity, data });
    },
    findOne: async (entity: unknown, where: unknown) => {
      findCalls.push({ entity, where });
      return {
        id: userId,
        email: 'user@example.com',
        passwordHash: 'argon2id-hash',
        role: 'USER',
        onboardingStatus: 'PENDING',
        onboardingCompletedAt: null,
        ageGroup: null,
        createdAt: now,
      };
    },
  });
  const repository = new PostgresAuthRepository(entityManager as never);

  const result = await repository.rotateRefreshSession({
    tokenHash: 'old-hash',
    replacement: {
      id: generateUuidV7(),
      tokenHash: 'new-hash',
      expiresAt: new Date('2026-10-14T12:00:00.000Z'),
      createdAt: now,
    },
    now,
  });

  assert.equal(result.status, 'rotated');
  assert.deepEqual(result.user, authUser());
  assert.equal(sqlCalls.length, 2);
  assert.equal(sqlCalls[0]?.method, 'get');
  assert.match(sqlCalls[0]?.sql ?? '', /FOR UPDATE/);
  assert.equal(sqlCalls[1]?.method, 'run');
  assert.match(sqlCalls[1]?.sql ?? '', /SET used_at/);
  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0]?.entity, RefreshSessionSchema);
  assert.equal((insertCalls[0]?.data as { userId: string }).userId, userId);
  assert.equal(findCalls[0]?.entity, UserSchema);
});

test('PostgresAuthRepository가 refresh token 재사용 시 ORM nativeUpdate로 모든 활성 세션을 revoke한다', async () => {
  const sqlCalls: string[] = [];
  const updateCalls: Array<{ entity: unknown; where: unknown; data: unknown }> = [];
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      sqlCalls.push(normalized);
      return {
        id: sessionId,
        user_id: userId,
        expires_at: new Date('2026-10-14T12:00:00.000Z'),
        used_at: new Date('2026-09-14T11:00:00.000Z'),
        revoked_at: null,
      };
    },
  };
  const entityManager = createEntityManager({
    connection,
    nativeUpdate: async (entity: unknown, where: unknown, data: unknown) => {
      updateCalls.push({ entity, where, data });
      return 2;
    },
  });
  const repository = new PostgresAuthRepository(entityManager as never);

  const result = await repository.rotateRefreshSession({
    tokenHash: 'used-hash',
    replacement: {
      id: generateUuidV7(),
      tokenHash: 'replacement-hash',
      expiresAt: new Date('2026-10-14T12:00:00.000Z'),
      createdAt: new Date('2026-09-14T12:00:00.000Z'),
    },
    now: new Date('2026-09-14T12:00:00.000Z'),
  });

  assert.deepEqual(result, { status: 'reused' });
  assert.equal(sqlCalls.length, 1);
  assert.match(sqlCalls[0] ?? '', /FOR UPDATE/);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.entity, RefreshSessionSchema);
  assert.deepEqual(updateCalls[0]?.where, { userId, usedAt: null, revokedAt: null });
});

test('PostgresAuthRepository가 만료된 refresh row를 회전하지 않고 invalid로 처리한다', async () => {
  const calls: string[] = [];
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      calls.push(sql.replace(/\s+/g, ' ').trim());
      return {
        id: sessionId,
        user_id: userId,
        expires_at: new Date('2026-09-13T12:00:00.000Z'),
        used_at: null,
        revoked_at: null,
      };
    },
  };
  const entityManager = createEntityManager({ connection });
  const repository = new PostgresAuthRepository(entityManager as never);

  const result = await repository.rotateRefreshSession({
    tokenHash: 'expired-hash',
    replacement: {
      id: generateUuidV7(),
      tokenHash: 'replacement-hash',
      expiresAt: new Date('2026-10-14T12:00:00.000Z'),
      createdAt: new Date('2026-09-14T12:00:00.000Z'),
    },
    now: new Date('2026-09-14T12:00:00.000Z'),
  });

  assert.deepEqual(result, { status: 'invalid' });
  assert.equal(calls.length, 1);
});

function createEntityManager(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const connection =
    (overrides.connection as { execute: (...args: never[]) => Promise<unknown> } | undefined) ??
    ({ execute: async () => undefined } as const);
  const entityManager: Record<string, unknown> = {
    getContext: () => entityManager,
    getConnection: () => connection,
    getTransactionContext: () => undefined,
    findOne: async () => null,
    insert: async () => undefined,
    nativeUpdate: async () => 0,
    ...overrides,
  };
  return entityManager;
}
