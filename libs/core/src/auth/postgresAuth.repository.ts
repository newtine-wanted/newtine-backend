import { EntityManager } from '@mikro-orm/core';
import { raw } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type { AuthRepository } from './repository/auth.repository.js';
import type {
  AuthUser,
  CreateAuthUserCommand,
  CreateRefreshSessionCommand,
  RotateRefreshSessionCommand,
  RotateRefreshSessionResult,
} from './domain/auth.model.js';
import { AuthRole } from './domain/auth.model.js';
import type { UuidV7 } from '../common/id/uuidV7.generator.js';
import { RefreshSessionSchema } from './persistence/auth.persistence.entity.js';
import {
  UserSchema,
  type UserPersistenceEntity,
} from '../user/persistence/user.persistence.entity.js';

interface RefreshSessionRotationRow {
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
    const entityManager = this.currentEntityManager();
    const row = await entityManager.findOne(UserSchema, {
      [raw((alias) => `lower(btrim(${alias}.email))`)]: email,
    });
    return row === null ? undefined : this.toAuthUser(row);
  }

  async findUserById(userId: UuidV7): Promise<AuthUser | undefined> {
    const row = await this.currentEntityManager().findOne(UserSchema, { id: userId });
    return row === null ? undefined : this.toAuthUser(row);
  }

  async createUser(command: CreateAuthUserCommand): Promise<AuthUser> {
    await this.currentEntityManager().insert(UserSchema, {
      id: command.id,
      email: command.email,
      passwordHash: command.passwordHash,
      role: command.role,
      onboardingStatus: 'PENDING',
      onboardingCompletedAt: null,
      ageGroup: null,
      createdAt: command.createdAt,
    });

    return {
      id: command.id,
      email: command.email,
      passwordHash: command.passwordHash,
      role: command.role,
    };
  }

  async createRefreshSession(command: CreateRefreshSessionCommand): Promise<void> {
    await this.currentEntityManager().insert(RefreshSessionSchema, {
      id: command.id,
      userId: command.userId,
      tokenHash: command.tokenHash,
      expiresAt: command.expiresAt,
      usedAt: null,
      revokedAt: null,
      createdAt: command.createdAt,
    });
  }

  async rotateRefreshSession(
    command: RotateRefreshSessionCommand,
  ): Promise<RotateRefreshSessionResult> {
    const entityManager = this.currentEntityManager();
    const session = await this.findRotationSession(entityManager, command.tokenHash);
    if (session === undefined) {
      return { status: 'invalid' };
    }

    if (session.used_at !== null || session.revoked_at !== null) {
      await this.revokeActiveSessions(entityManager, session.user_id, command.now);
      return { status: 'reused' };
    }

    if (new Date(session.expires_at).getTime() <= command.now.getTime()) {
      return { status: 'invalid' };
    }

    const consumed = await this.executeRotationCommand(
      entityManager,
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
      await this.revokeActiveSessions(entityManager, session.user_id, command.now);
      return { status: 'reused' };
    }

    await this.createRefreshSession({
      ...command.replacement,
      userId: session.user_id as CreateRefreshSessionCommand['userId'],
    });
    const user = await this.findUserById(session.user_id as UuidV7);
    if (user === undefined) {
      throw new Error('Refresh session owner no longer exists');
    }

    return { status: 'rotated', user };
  }

  async revokeRefreshSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.currentEntityManager().nativeUpdate(
      RefreshSessionSchema,
      { tokenHash, usedAt: null, revokedAt: null },
      { revokedAt },
    );
  }

  private async findRotationSession(
    entityManager: EntityManager,
    tokenHash: string,
  ): Promise<RefreshSessionRotationRow | undefined> {
    return this.executeRotationQuery<RefreshSessionRotationRow>(
      entityManager,
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
      [tokenHash],
    );
  }

  private async revokeActiveSessions(
    entityManager: EntityManager,
    userId: string,
    revokedAt: Date,
  ): Promise<void> {
    await entityManager.nativeUpdate(
      RefreshSessionSchema,
      { userId, usedAt: null, revokedAt: null },
      { revokedAt },
    );
  }

  private toAuthUser(row: UserPersistenceEntity): AuthUser {
    if (row.role !== AuthRole.User && row.role !== AuthRole.Admin) {
      throw new Error('users.role contains an unsupported value');
    }

    return {
      id: row.id as AuthUser['id'],
      email: row.email,
      passwordHash: row.passwordHash,
      role: row.role,
    };
  }

  private currentEntityManager(): EntityManager {
    return this.entityManager.getContext(false);
  }

  private async executeRotationQuery<T extends object>(
    entityManager: EntityManager,
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    return (await entityManager
      .getConnection()
      .execute(sql, params, 'get', entityManager.getTransactionContext())) as T | undefined;
  }

  private async executeRotationCommand(
    entityManager: EntityManager,
    sql: string,
    params: unknown[] = [],
  ): Promise<RunResult> {
    return (await entityManager
      .getConnection()
      .execute(sql, params, 'run', entityManager.getTransactionContext())) as RunResult;
  }
}
