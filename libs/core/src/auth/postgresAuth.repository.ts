import { EntityManager } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import {
  AuthRole,
  type AuthRepository,
  type AuthUser,
  type CreateAuthUserCommand,
  type CreateRefreshSessionCommand,
  type RotateRefreshSessionCommand,
  type RotateRefreshSessionResult,
} from './auth.model.js';

interface AuthUserRow {
  readonly id: string;
  readonly email: string | null;
  readonly password_hash: string | null;
  readonly role: string;
}

interface RefreshSessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly expires_at: Date | string;
  readonly used_at: Date | string | null;
  readonly revoked_at: Date | string | null;
}

interface RunResult {
  readonly affectedRows: number;
}

/** PostgreSQL adapter for account credentials and refresh-token state. */
@Injectable()
export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    const row = await this.queryOne<AuthUserRow>(
      `
        SELECT id::text AS id,
               lower(btrim(email)) AS email,
               password_hash,
               role
          FROM users
         WHERE email IS NOT NULL
           AND lower(btrim(email)) = ?::text
         LIMIT 1
      `,
      [email],
    );
    return row === undefined ? undefined : this.toAuthUser(row);
  }

  async findUserById(userId: string): Promise<AuthUser | undefined> {
    const row = await this.queryOne<AuthUserRow>(
      `
        SELECT id::text AS id,
               lower(btrim(email)) AS email,
               password_hash,
               role
          FROM users
         WHERE id = ?::uuid
         LIMIT 1
      `,
      [userId],
    );
    return row === undefined ? undefined : this.toAuthUser(row);
  }

  async createUser(command: CreateAuthUserCommand): Promise<AuthUser> {
    await this.execute(
      `
        INSERT INTO users
          (id, email, password_hash, role, onboarding_status, created_at)
        VALUES
          (?::uuid, ?::text, ?::text, ?::text, 'PENDING', ?::timestamptz)
      `,
      [command.id, command.email, command.passwordHash, command.role, command.createdAt],
    );

    return {
      id: command.id,
      email: command.email,
      passwordHash: command.passwordHash,
      role: command.role,
    };
  }

  async createRefreshSession(command: CreateRefreshSessionCommand): Promise<void> {
    await this.execute(
      `
        INSERT INTO refresh_sessions
          (id, user_id, token_hash, expires_at, created_at)
        VALUES
          (?::uuid, ?::uuid, ?::text, ?::timestamptz, ?::timestamptz)
      `,
      [command.id, command.userId, command.tokenHash, command.expiresAt, command.createdAt],
    );
  }

  async rotateRefreshSession(
    command: RotateRefreshSessionCommand,
  ): Promise<RotateRefreshSessionResult> {
    const session = await this.queryOne<RefreshSessionRow>(
      `
        SELECT id::text AS id,
               user_id::text AS user_id,
               expires_at,
               used_at,
               revoked_at
          FROM refresh_sessions
         WHERE token_hash = ?::text
         FOR UPDATE
      `,
      [command.tokenHash],
    );
    if (session === undefined) {
      return { status: 'invalid' };
    }

    if (session.used_at !== null || session.revoked_at !== null) {
      await this.revokeActiveSessions(session.user_id, command.now);
      return { status: 'reused' };
    }

    if (new Date(session.expires_at).getTime() <= command.now.getTime()) {
      return { status: 'invalid' };
    }

    const consumed = await this.execute(
      `
        UPDATE refresh_sessions
           SET used_at = ?::timestamptz
         WHERE id = ?::uuid
           AND used_at IS NULL
           AND revoked_at IS NULL
      `,
      [command.now, session.id],
    );
    if (consumed.affectedRows !== 1) {
      await this.revokeActiveSessions(session.user_id, command.now);
      return { status: 'reused' };
    }

    await this.createRefreshSession({
      ...command.replacement,
      userId: session.user_id as CreateRefreshSessionCommand['userId'],
    });
    const user = await this.findUserById(session.user_id);
    if (user === undefined) {
      throw new Error('Refresh session owner no longer exists');
    }

    return { status: 'rotated', user };
  }

  async revokeRefreshSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.execute(
      `
        UPDATE refresh_sessions
           SET revoked_at = ?::timestamptz
         WHERE token_hash = ?::text
           AND used_at IS NULL
           AND revoked_at IS NULL
      `,
      [revokedAt, tokenHash],
    );
  }

  private async revokeActiveSessions(userId: string, revokedAt: Date): Promise<void> {
    await this.execute(
      `
        UPDATE refresh_sessions
           SET revoked_at = COALESCE(revoked_at, ?::timestamptz)
         WHERE user_id = ?::uuid
           AND used_at IS NULL
           AND revoked_at IS NULL
      `,
      [revokedAt, userId],
    );
  }

  private toAuthUser(row: AuthUserRow): AuthUser {
    if (row.role !== AuthRole.User && row.role !== AuthRole.Admin) {
      throw new Error('users.role contains an unsupported value');
    }

    return {
      id: row.id as AuthUser['id'],
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
    };
  }

  private currentEntityManager(): EntityManager {
    return this.entityManager.getContext(false);
  }

  private async queryOne<T extends object>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    const entityManager = this.currentEntityManager();
    return (await entityManager
      .getConnection()
      .execute(sql, params, 'get', entityManager.getTransactionContext())) as T | undefined;
  }

  private async execute(sql: string, params: unknown[] = []): Promise<RunResult> {
    const entityManager = this.currentEntityManager();
    return (await entityManager
      .getConnection()
      .execute(sql, params, 'run', entityManager.getTransactionContext())) as RunResult;
  }
}
