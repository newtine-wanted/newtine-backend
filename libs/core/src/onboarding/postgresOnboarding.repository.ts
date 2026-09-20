import { EntityManager } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import type { CategoryCode } from '@newtine/core/common/category/category.catalog.js';
import {
  OnboardingException,
  OnboardingExceptionCode,
  type OnboardingSelectionDerivationAnomaly,
} from './onboarding.exception.js';
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
  readonly topic_codes: unknown;
  readonly entity_ids: unknown;
  readonly selection_anomaly: unknown;
  readonly selection_anomaly_details: unknown;
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

interface CategoryResidualRow {
  readonly category_code: CategoryCode;
  readonly aggregate_weight: unknown;
  readonly action_weight: unknown;
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

    const selection = await this.validateSelection(command);
    const categoryResiduals = await this.loadCategoryResiduals(userId);
    this.assertCategoryResiduals(userId, categoryResiduals);

    await this.replaceCategoryPreferences(userId, selection.categoryCodes, categoryResiduals);
    await this.replaceEntityPreferences(userId, command.entityIds);
    await this.replaceRegionPreferences(userId, command.regionCodes);

    const updated = await this.execute(
      `
        UPDATE users
           SET age_group = ?::text,
               onboarding_status = 'COMPLETED',
               onboarding_completed_at = COALESCE(onboarding_completed_at, clock_timestamp())
         WHERE id = ?::uuid
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

  private async loadCategoryResiduals(userId: string): Promise<readonly CategoryResidualRow[]> {
    return this.queryRows<CategoryResidualRow>(
      `
        WITH category_totals AS (
          SELECT p.category_code,
                 p.weight::numeric AS aggregate_weight,
                 0::numeric AS action_weight
            FROM user_category_preferences p
           WHERE p.user_id = ?::uuid
          UNION ALL
          SELECT c.category_code,
                 0::numeric AS aggregate_weight,
                 SUM(c.action_score + c.dwell_score)::numeric AS action_weight
            FROM user_issue_contributions c
           WHERE c.user_id = ?::uuid
           GROUP BY c.category_code
        )
        SELECT category_code,
               SUM(aggregate_weight)::numeric AS aggregate_weight,
               SUM(action_weight)::numeric AS action_weight
          FROM category_totals
         GROUP BY category_code
         ORDER BY category_code
      `,
      [userId, userId],
    );
  }

  private assertCategoryResiduals(userId: string, rows: readonly CategoryResidualRow[]): void {
    const anomalies = rows
      .filter((row) => !isAllowedCategoryResidual(categoryResidual(row)))
      .map(toSelectionDerivationAnomaly);
    if (anomalies.length > 0) {
      throw this.selectionDerivationAnomaly(userId, anomalies);
    }
  }

  private async replaceCategoryPreferences(
    userId: string,
    selectedCategoryCodes: readonly CategoryCode[],
    residuals: readonly CategoryResidualRow[],
  ): Promise<void> {
    const actionWeights = new Map(
      residuals.map((row) => [row.category_code, numeric(row.action_weight)]),
    );
    const selected = new Set(selectedCategoryCodes);
    const categoryCodes = new Set([...actionWeights.keys(), ...selected]);

    await this.execute('DELETE FROM user_category_preferences WHERE user_id = ?::uuid', [userId]);
    for (const categoryCode of [...categoryCodes].sort()) {
      const weight = (actionWeights.get(categoryCode) ?? 0) + (selected.has(categoryCode) ? 2 : 0);
      await this.execute(
        `
          INSERT INTO user_category_preferences
            (user_category_preferences_id, user_id, category_code, weight)
          VALUES (?::uuid, ?::uuid, ?::text, ?::numeric)
        `,
        [generateUuidV7(), userId, categoryCode, weight],
      );
    }
  }

  private async replaceEntityPreferences(
    userId: string,
    entityIds: readonly string[],
  ): Promise<void> {
    await this.execute('DELETE FROM user_entity_preferences WHERE user_id = ?::uuid', [userId]);
    for (const entityId of entityIds) {
      await this.execute(
        `
          INSERT INTO user_entity_preferences
            (user_entity_preferences_id, user_id, entity_id, weight)
          VALUES (?::uuid, ?::uuid, ?::uuid, 2)
        `,
        [generateUuidV7(), userId, entityId],
      );
    }
  }

  private async replaceRegionPreferences(
    userId: string,
    regionCodes: readonly string[],
  ): Promise<void> {
    await this.execute('DELETE FROM user_region_preferences WHERE user_id = ?::uuid', [userId]);
    for (const regionCode of regionCodes) {
      await this.execute(
        `
          INSERT INTO user_region_preferences
            (id, user_id, region_code, weight)
          VALUES (?::uuid, ?::uuid, ?::text, 1)
        `,
        [generateUuidV7(), userId, regionCode],
      );
    }
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
        WITH category_totals AS (
          SELECT p.category_code,
                 p.weight::numeric AS aggregate_weight,
                 0::numeric AS action_weight
            FROM user_category_preferences p
           WHERE p.user_id = ?::uuid
          UNION ALL
          SELECT c.category_code,
                 0::numeric AS aggregate_weight,
                 SUM(c.action_score + c.dwell_score)::numeric AS action_weight
            FROM user_issue_contributions c
           WHERE c.user_id = ?::uuid
           GROUP BY c.category_code
        ),
        category_residuals AS (
          SELECT category_code,
                 SUM(aggregate_weight)::numeric AS aggregate_weight,
                 SUM(action_weight)::numeric AS action_weight
            FROM category_totals
           GROUP BY category_code
        )
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
               ), '[]'::jsonb) AS region_codes,
               COALESCE((
                 SELECT jsonb_agg(r.category_code ORDER BY c.display_order, r.category_code)
                   FROM category_residuals r
                   JOIN issue_categories c ON c.code = r.category_code
                  WHERE r.aggregate_weight - r.action_weight = 2
               ), '[]'::jsonb) AS topic_codes,
               COALESCE((
                 SELECT jsonb_agg(
                          jsonb_build_object(
                            'category_code', r.category_code,
                            'aggregate_weight', r.aggregate_weight,
                            'action_weight', r.action_weight,
                            'residual', r.aggregate_weight - r.action_weight
                          )
                          ORDER BY r.category_code
                        )
                   FROM category_residuals r
                  WHERE r.aggregate_weight - r.action_weight NOT IN (0, 2)
               ), '[]'::jsonb) AS selection_anomaly_details,
               COALESCE((
                 SELECT jsonb_agg(p.entity_id::text ORDER BY p.entity_id::text)
                   FROM user_entity_preferences p
                  WHERE p.user_id = u.id
                    AND p.weight > 0
               ), '[]'::jsonb) AS entity_ids,
               EXISTS (
                 SELECT 1
                   FROM category_residuals r
                  WHERE r.aggregate_weight - r.action_weight NOT IN (0, 2)
               ) AS selection_anomaly
          FROM users u
         WHERE u.id = ?::uuid
      `,
      [userId, userId, userId],
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
    if (parseBoolean(snapshot.selection_anomaly)) {
      throw this.selectionDerivationAnomaly(
        snapshot.id,
        parseSelectionDerivationAnomalies(snapshot.selection_anomaly_details),
      );
    }

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
      topicCodes: parseCategoryCodes(snapshot.topic_codes),
      entityIds: parseStringArray(snapshot.entity_ids),
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

  private selectionDerivationAnomaly(
    userId: string,
    anomalies: readonly OnboardingSelectionDerivationAnomaly[],
  ): OnboardingException {
    return new OnboardingException(
      OnboardingExceptionCode.SelectionDerivationAnomaly,
      '관심 설정 aggregate의 derived selection을 계산할 수 없습니다.',
      undefined,
      {
        kind: 'selection_derivation_anomaly',
        userId,
        anomalies,
      },
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

function parseCategoryCodes(value: unknown): CategoryCode[] {
  return parseStringArray(value) as CategoryCode[];
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function categoryResidual(row: CategoryResidualRow): number {
  return numeric(row.aggregate_weight) - numeric(row.action_weight);
}

function toSelectionDerivationAnomaly(
  row: CategoryResidualRow,
): OnboardingSelectionDerivationAnomaly {
  const aggregateWeight = numeric(row.aggregate_weight);
  const actionWeight = numeric(row.action_weight);
  return {
    categoryCode: row.category_code,
    aggregateWeight,
    actionWeight,
    residual: aggregateWeight - actionWeight,
  };
}

function isAllowedCategoryResidual(value: number): boolean {
  return Number.isFinite(value) && (value === 0 || value === 2);
}

function parseSelectionDerivationAnomalies(
  value: unknown,
): readonly OnboardingSelectionDerivationAnomaly[] {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const categoryCode = record.category_code;
    const aggregateWeight = numeric(record.aggregate_weight);
    const actionWeight = numeric(record.action_weight);
    const residual = numeric(record.residual);
    if (
      typeof categoryCode !== 'string' ||
      !Number.isFinite(aggregateWeight) ||
      !Number.isFinite(actionWeight) ||
      !Number.isFinite(residual)
    ) {
      return [];
    }
    return [{ categoryCode, aggregateWeight, actionWeight, residual }];
  });
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
