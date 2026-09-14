import { EntityManager } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import type { CategoryCode } from '@newtine/core/common/category/category.catalog.js';
import { OnboardingException, OnboardingExceptionCode } from './onboarding.exception.js';
import { ONBOARDING_OPTIONS } from './onboarding.options.js';
import {
  EntityType,
  OnboardingStatus,
  type CompleteOnboardingCommand,
  type EntitySearchCommand,
  type EntitySearchResult,
  type OnboardingEntity,
  type OnboardingOptions,
  type OnboardingPreferenceSnapshot,
  type OnboardingRepository,
  type OnboardingStateWithPreferences,
} from './onboarding.model.js';

interface UserRow {
  readonly id: string;
  readonly onboarding_status: string;
  readonly onboarding_completed_at: Date | string | null;
  readonly age_group: string | null;
}

interface SnapshotRow extends UserRow {
  readonly topic_weights: unknown;
  readonly entity_weights: unknown;
  readonly region_weights: unknown;
  readonly region_codes: unknown;
}

interface EntityRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly subtitle: string | null;
  readonly aliases: string[];
}

interface CountRow {
  readonly total: number | string;
}

interface CategoryRow {
  readonly code: CategoryCode;
}

interface RegionRow {
  readonly region_code: string;
}

interface RunResult {
  readonly affectedRows: number;
}

/**
 * PostgreSQL adapter for the approved first-onboarding contract.
 *
 * The write methods assume the caller owns the top-level transaction. They use
 * the ambient MikroORM transaction context, lock the user row before deciding
 * whether the request is terminal, and never commit independently.
 */
@Injectable()
export class PostgresOnboardingRepository implements OnboardingRepository {
  constructor(private readonly entityManager: EntityManager) {}

  getOptions(): OnboardingOptions {
    // Catalog labels and order are application-owned constants. The migration
    // seeds matching category/region rows so writes can resolve stable codes.
    return ONBOARDING_OPTIONS;
  }

  async searchEntities(command: EntitySearchCommand): Promise<EntitySearchResult> {
    const prefix = command.query?.trim() || null;
    const type = command.type ?? null;
    const params = [
      prefix === null ? null : `${escapeLikePrefix(prefix)}%`,
      prefix === null ? null : `${escapeLikePrefix(prefix)}%`,
      type,
      type,
    ];
    const where = `
      WHERE is_active = TRUE
        AND (?::text IS NULL OR name ILIKE ?::text)
        AND (?::text IS NULL OR type = ?::text)
    `;
    const count = await this.queryOne<CountRow>(
      `SELECT COUNT(*)::int AS total FROM entities ${where}`,
      params,
    );
    const rows = await this.queryRows<EntityRow>(
      `
        SELECT id::text AS id,
               name,
               type,
               subtitle,
               COALESCE(aliases, ARRAY[]::text[]) AS aliases
          FROM entities
          ${where}
         ORDER BY name ASC, id ASC
         LIMIT ?::int
        OFFSET ?::int
      `,
      [...params, command.limit, command.offset],
    );

    return {
      items: rows.map((row) => this.toEntity(row)),
      total: Number(count?.total ?? 0),
      limit: command.limit,
      offset: command.offset,
    };
  }

  async findOnboarding(userId: string): Promise<OnboardingStateWithPreferences | undefined> {
    const snapshot = await this.findSnapshot(userId);
    return snapshot === undefined ? undefined : this.toSnapshot(snapshot);
  }

  async completeOnboarding(
    userId: string,
    command: CompleteOnboardingCommand,
  ): Promise<OnboardingStateWithPreferences> {
    const user = await this.findUser(userId, true);
    if (user === undefined) {
      throw this.userNotFound();
    }
    if (user.onboarding_status !== OnboardingStatus.Pending) {
      return this.requireSnapshot(user.id);
    }

    const selection = await this.validateSelection(command);

    for (const categoryCode of selection.categoryCodes) {
      await this.execute(
        `
          INSERT INTO user_category_preferences
            (user_category_preferences_id, user_id, category_code, weight)
          VALUES (?::uuid, ?::uuid, ?::text, 2)
          ON CONFLICT (user_id, category_code)
          DO UPDATE SET weight = user_category_preferences.weight + 2
        `,
        [generateUuidV7(), userId, categoryCode],
      );
    }
    for (const entityId of command.entityIds) {
      await this.execute(
        `
          INSERT INTO user_entity_preferences
            (user_entity_preference_id, user_id, entity_id, weight)
          VALUES (?::uuid, ?::uuid, ?::uuid, 2)
          ON CONFLICT (user_id, entity_id)
          DO UPDATE SET weight = user_entity_preferences.weight + 2
        `,
        [generateUuidV7(), userId, entityId],
      );
    }
    for (const regionCode of command.regionCodes) {
      await this.execute(
        `
          INSERT INTO user_region_preferences
            (id, user_id, region_code, weight)
          VALUES (?::uuid, ?::uuid, ?::text, 1)
          ON CONFLICT (user_id, region_code)
          DO UPDATE SET weight = user_region_preferences.weight + 1
        `,
        [generateUuidV7(), userId, regionCode],
      );
    }

    const updated = await this.execute(
      `
        UPDATE users
           SET age_group = ?::text,
               onboarding_status = 'COMPLETED',
               onboarding_completed_at = now()
         WHERE id = ?::uuid
           AND onboarding_status = 'PENDING'
      `,
      [command.ageGroup, userId],
    );
    if (updated.affectedRows !== 1) {
      throw new Error('온보딩 상태를 완료로 전환하지 못했습니다.');
    }

    return this.requireSnapshot(userId);
  }

  async skipOnboarding(userId: string): Promise<OnboardingStateWithPreferences> {
    const user = await this.findUser(userId, true);
    if (user === undefined) {
      throw this.userNotFound();
    }
    if (user.onboarding_status !== OnboardingStatus.Pending) {
      return this.requireSnapshot(user.id);
    }

    const updated = await this.execute(
      `
        UPDATE users
           SET age_group = NULL,
               onboarding_status = 'SKIPPED',
               onboarding_completed_at = NULL
         WHERE id = ?::uuid
           AND onboarding_status = 'PENDING'
      `,
      [userId],
    );
    if (updated.affectedRows !== 1) {
      throw new Error('온보딩 상태를 건너뛰기로 전환하지 못했습니다.');
    }

    return this.requireSnapshot(userId);
  }

  private async validateSelection(command: CompleteOnboardingCommand): Promise<{
    readonly categoryCodes: readonly CategoryCode[];
  }> {
    const topicCodes = new Set(command.topicCodes);
    const entityIds = new Set(command.entityIds);
    const regionCodes = new Set(command.regionCodes);
    const validTopics = new Set(ONBOARDING_OPTIONS.topics.map((option) => option.code));
    const validAgeGroups = new Set(ONBOARDING_OPTIONS.ageGroups.map((option) => option.code));
    const validRegions = new Set(ONBOARDING_OPTIONS.regions.map((option) => option.code));

    if (
      topicCodes.size !== command.topicCodes.length ||
      topicCodes.size < 1 ||
      topicCodes.size > ONBOARDING_OPTIONS.topics.length ||
      [...topicCodes].some((code) => !validTopics.has(code))
    ) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '관심 주제 선택이 올바르지 않습니다.',
      );
    }
    if (command.ageGroup !== null && !validAgeGroups.has(command.ageGroup)) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '나이대 선택이 올바르지 않습니다.',
      );
    }
    if (
      entityIds.size !== command.entityIds.length ||
      entityIds.size > 100 ||
      [...entityIds].some((id) => !isUuid(id))
    ) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '인물·정당·기관 선택이 올바르지 않습니다.',
      );
    }
    if (
      regionCodes.size !== command.regionCodes.length ||
      regionCodes.size > ONBOARDING_OPTIONS.regions.length ||
      [...regionCodes].some((code) => !validRegions.has(code))
    ) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '관심 지역 선택이 올바르지 않습니다.',
      );
    }

    const categoryRows = await this.queryRows<CategoryRow>(
      `SELECT code FROM issue_categories WHERE code IN (?)`,
      [command.topicCodes],
    );
    if (categoryRows.length !== topicCodes.size) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '관심 주제 선택이 올바르지 않습니다.',
      );
    }

    if (entityIds.size > 0) {
      const activeEntities = await this.queryRows<{ id: string }>(
        `SELECT id::text AS id FROM entities WHERE id IN (?) AND is_active = TRUE`,
        [command.entityIds],
      );
      if (activeEntities.length !== entityIds.size) {
        throw new OnboardingException(
          OnboardingExceptionCode.InvalidSelection,
          '인물·정당·기관 선택이 올바르지 않습니다.',
        );
      }
    }

    if (regionCodes.size > 0) {
      const regions = await this.queryRows<RegionRow>(
        `SELECT code AS region_code FROM regions WHERE code IN (?)`,
        [command.regionCodes],
      );
      if (regions.length !== regionCodes.size) {
        throw new OnboardingException(
          OnboardingExceptionCode.InvalidSelection,
          '관심 지역 선택이 올바르지 않습니다.',
        );
      }
    }

    return { categoryCodes: categoryRows.map((row) => row.code) };
  }

  private async findUser(userId: string, lock: boolean): Promise<UserRow | undefined> {
    return this.queryOne<UserRow>(
      `
        SELECT id::text AS id,
               onboarding_status,
               onboarding_completed_at,
               age_group
          FROM users
         WHERE id = ?::uuid
         ${lock ? 'FOR UPDATE' : ''}
      `,
      [userId],
    );
  }

  private async findSnapshot(userId: string): Promise<SnapshotRow | undefined> {
    return this.queryOne<SnapshotRow>(
      `
        SELECT u.id::text AS id,
               u.onboarding_status,
               u.onboarding_completed_at,
               u.age_group,
               COALESCE((
                 SELECT jsonb_object_agg(p.category_code, p.weight)
                   FROM user_category_preferences p
                  WHERE p.user_id = u.id
               ), '{}'::jsonb) AS topic_weights,
               COALESCE((
                 SELECT jsonb_object_agg(p.entity_id::text, p.weight)
                   FROM user_entity_preferences p
                  WHERE p.user_id = u.id
               ), '{}'::jsonb) AS entity_weights,
               COALESCE((
                 SELECT jsonb_object_agg(p.region_code, p.weight)
                   FROM user_region_preferences p
                  WHERE p.user_id = u.id
               ), '{}'::jsonb) AS region_weights,
               COALESCE((
                 SELECT jsonb_agg(p.region_code ORDER BY p.region_code)
                   FROM user_region_preferences p
                  WHERE p.user_id = u.id
               ), '[]'::jsonb) AS region_codes
          FROM users u
         WHERE u.id = ?::uuid
      `,
      [userId],
    );
  }

  private async requireSnapshot(userId: string): Promise<OnboardingStateWithPreferences> {
    const snapshot = await this.findSnapshot(userId);
    if (snapshot === undefined) {
      throw this.userNotFound();
    }
    return this.toSnapshot(snapshot);
  }

  private toSnapshot(snapshot: SnapshotRow): OnboardingStateWithPreferences {
    const preferences: OnboardingPreferenceSnapshot = {
      topicWeights: parseWeightObject(snapshot.topic_weights),
      entityWeights: parseWeightObject(snapshot.entity_weights),
      regionWeights: parseWeightObject(snapshot.region_weights),
    };

    return {
      userId: snapshot.id as OnboardingStateWithPreferences['userId'],
      status: snapshot.onboarding_status as OnboardingStateWithPreferences['status'],
      completedAt:
        snapshot.onboarding_completed_at === null
          ? null
          : new Date(snapshot.onboarding_completed_at),
      ageGroup: snapshot.age_group as OnboardingStateWithPreferences['ageGroup'],
      regionCodes: parseStringArray(snapshot.region_codes),
      preferences,
    };
  }

  private toEntity(row: EntityRow): OnboardingEntity {
    return {
      id: row.id as OnboardingEntity['id'],
      name: row.name,
      type: row.type as (typeof EntityType)[keyof typeof EntityType],
      ...(row.subtitle === null ? {} : { subtitle: row.subtitle }),
      aliases: row.aliases ?? [],
      isActive: true,
    };
  }

  private userNotFound(): OnboardingException {
    return new OnboardingException(
      OnboardingExceptionCode.UserNotFound,
      '인증된 사용자를 찾을 수 없습니다.',
    );
  }

  private currentEntityManager(): EntityManager {
    return this.entityManager.getContext(false);
  }

  private async queryRows<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
    const entityManager = this.currentEntityManager();
    return (await entityManager
      .getConnection()
      .execute(sql, params, 'all', entityManager.getTransactionContext())) as T[];
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeLikePrefix(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function parseWeightObject(value: unknown): Record<string, number> {
  const object = parseJsonValue(value);
  if (object === null || Array.isArray(object) || typeof object !== 'object') {
    return {};
  }
  return Object.fromEntries(Object.entries(object).map(([key, weight]) => [key, Number(weight)]));
}

function parseStringArray(value: unknown): string[] {
  const array = parseJsonValue(value);
  return Array.isArray(array)
    ? array.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
