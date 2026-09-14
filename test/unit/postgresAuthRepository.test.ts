import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { AuthRole, PostgresAuthRepository, generateUuidV7, type AuthUser } from '@newtine/core';

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

test('PostgresAuthRepository finds users through canonical email SQL and validates the role', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const repository = createRepository(async (sql, params) => {
    calls.push({ sql, params });
    return {
      id: userId,
      email: 'user@example.com',
      password_hash: 'argon2id-hash',
      role: 'USER',
    };
  });

  const result = await repository.findUserByEmail('user@example.com');

  assert.deepEqual(result, authUser({ email: 'user@example.com' }));
  assert.match(calls[0]?.sql ?? '', /lower\(btrim\(email\)\)/);
  assert.deepEqual(calls[0]?.params, ['user@example.com']);
});

test('PostgresAuthRepository atomically consumes a refresh row and binds replacement to its owner', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const now = new Date('2026-09-14T12:00:00.000Z');
  const connection = {
    execute: async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      const normalized = sql.replace(/\s+/g, ' ').trim();
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
      if (normalized.startsWith('INSERT INTO refresh_sessions')) return { affectedRows: 1 };
      if (normalized.includes('FROM users')) {
        return {
          id: userId,
          email: 'user@example.com',
          password_hash: 'argon2id-hash',
          role: 'USER',
        };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
  const entityManager = {
    getContext: () => entityManager,
    getConnection: () => connection,
    getTransactionContext: () => undefined,
  };
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
  assert.match(calls[0]?.sql ?? '', /FOR UPDATE/);
  assert.match(calls[1]?.sql ?? '', /SET used_at/);
  assert.match(calls[2]?.sql ?? '', /INSERT INTO refresh_sessions/);
  assert.ok(calls[2]?.params.includes(userId));
  assert.equal(
    calls.some(({ sql }) => /\$\d+/.test(sql)),
    false,
  );
});

test('PostgresAuthRepository revokes all active sessions on refresh reuse', async () => {
  const calls: string[] = [];
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized.includes('FROM refresh_sessions')) {
        return {
          id: sessionId,
          user_id: userId,
          expires_at: new Date('2026-10-14T12:00:00.000Z'),
          used_at: new Date('2026-09-14T11:00:00.000Z'),
          revoked_at: null,
        };
      }
      if (normalized.startsWith('UPDATE refresh_sessions')) return { affectedRows: 2 };
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
  const entityManager = {
    getContext: () => entityManager,
    getConnection: () => connection,
    getTransactionContext: () => undefined,
  };
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
  assert.match(calls[1] ?? '', /WHERE user_id/);
  assert.match(calls[1] ?? '', /used_at IS NULL/);
  assert.match(calls[1] ?? '', /revoked_at IS NULL/);
  assert.equal(
    calls.some((sql) => sql.startsWith('INSERT INTO refresh_sessions')),
    false,
  );
});

test('PostgresAuthRepository leaves expired refresh rows invalid without rotating them', async () => {
  const calls: string[] = [];
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      return {
        id: sessionId,
        user_id: userId,
        expires_at: new Date('2026-09-13T12:00:00.000Z'),
        used_at: null,
        revoked_at: null,
      };
    },
  };
  const entityManager = {
    getContext: () => entityManager,
    getConnection: () => connection,
    getTransactionContext: () => undefined,
  };
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

function createRepository(
  execute: (sql: string, params: unknown[]) => Promise<unknown>,
): PostgresAuthRepository {
  const connection = {
    execute: (sql: string, params: unknown[] = []) => execute(sql, params),
  };
  const entityManager = {
    getContext: () => entityManager,
    getConnection: () => connection,
    getTransactionContext: () => undefined,
  };
  return new PostgresAuthRepository(entityManager as never);
}
