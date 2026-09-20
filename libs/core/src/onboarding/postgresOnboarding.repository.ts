import { EntityManager, LockMode } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import type { CategoryCode } from '@newtine/core/common/category/category.catalog.js';
import {
  IssueCategorySchema,
  OnboardingEntitySchema,
  RegionSchema,
  UserCategoryPreferenceSchema,
  UserEntityPreferenceSchema,
  UserRegionPreferenceSchema,
} from './persistence/onboarding.persistence.entity.js';
import { UserIssueContributionSchema } from '../interest/persistence/interest.persistence.entity.js';
import {
  UserSchema,
  type UserPersistenceEntity,
} from '../user/persistence/user.persistence.entity.js';
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

interface EntityRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly subtitle: string | null | undefined;
  readonly aliases: string[];
  readonly isActive: boolean;
}

interface CategoryResidualRow {
  readonly category_code: CategoryCode;
  readonly aggregate_weight: unknown;
  readonly action_weight: unknown;
}

interface CategoryPreferenceRow {
  readonly categoryCode: string;
  readonly weight: unknown;
}

interface EntityPreferenceRow {
  readonly entityId: string;
  readonly weight: unknown;
}

interface RegionPreferenceRow {
  readonly regionCode: string;
  readonly weight: unknown;
}

interface ContributionRow {
  readonly categoryCode: string;
  readonly actionScore: unknown;
  readonly dwellScore: unknown;
}

interface SnapshotData {
  readonly user: UserPersistenceEntity;
  readonly categoryPreferences: readonly CategoryPreferenceRow[];
  readonly entityPreferences: readonly EntityPreferenceRow[];
  readonly regionPreferences: readonly RegionPreferenceRow[];
  readonly categoryResiduals: readonly CategoryResidualRow[];
  readonly topicCodes: readonly CategoryCode[];
  readonly entityIds: readonly string[];
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
    const where = {
      isActive: true,
      ...(prefix === null ? {} : { name: { $ilike: `${escapeLikePrefix(prefix)}%` } }),
      ...(command.type === undefined ? {} : { type: command.type }),
    };
    const [rows, total] = await this.currentEntityManager().findAndCount(
      OnboardingEntitySchema,
      where,
      {
        limit: command.limit,
        offset: command.offset,
        orderBy: { name: 'asc', id: 'asc' },
      },
    );

    return {
      items: rows.map((row) => this.toEntity(row)),
      total,
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

    const onboardingCompletedAt = user.onboardingCompletedAt ?? new Date();
    const updated = await this.currentEntityManager().nativeUpdate(
      UserSchema,
      { id: userId },
      {
        ageGroup: command.ageGroup,
        onboardingStatus: OnboardingStatus.Completed,
        onboardingCompletedAt,
      },
    );
    if (updated !== 1) {
      throw new Error('온보딩 상태를 완료로 전환하지 못했습니다.');
    }

    // nativeUpdate intentionally bypasses the identity-map change tracking.
    // Refresh the locked entity so the snapshot returned from this same
    // transaction reflects the committed write rather than the pre-update row.
    await this.currentEntityManager().findOne(UserSchema, { id: userId }, { refresh: true });

    return this.requireSnapshot(userId);
  }

  async skipOnboarding(userId: string): Promise<OnboardingStateWithPreferences> {
    const user = await this.findUser(userId, true);
    if (user === undefined) {
      throw this.userNotFound();
    }
    if (user.onboardingStatus !== OnboardingStatus.Pending) {
      return this.requireSnapshot(user.id);
    }

    const updated = await this.currentEntityManager().nativeUpdate(
      UserSchema,
      { id: userId, onboardingStatus: OnboardingStatus.Pending },
      {
        ageGroup: null,
        onboardingStatus: OnboardingStatus.Skipped,
        onboardingCompletedAt: null,
      },
    );
    if (updated !== 1) {
      throw new Error('온보딩 상태를 건너뛰기로 전환하지 못했습니다.');
    }

    // See completeOnboarding: nativeUpdate does not refresh the locked entity
    // already held by this EntityManager.
    await this.currentEntityManager().findOne(UserSchema, { id: userId }, { refresh: true });

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

    const categoryRows = await this.currentEntityManager().find(IssueCategorySchema, {
      code: { $in: [...topicCodes] },
    });
    if (categoryRows.length !== topicCodes.size) {
      throw new OnboardingException(
        OnboardingExceptionCode.InvalidSelection,
        '관심 주제 선택이 올바르지 않습니다.',
      );
    }

    if (entityIds.size > 0) {
      const activeEntities = await this.currentEntityManager().find(OnboardingEntitySchema, {
        id: { $in: [...entityIds] },
        isActive: true,
      });
      if (activeEntities.length !== entityIds.size) {
        throw new OnboardingException(
          OnboardingExceptionCode.InvalidSelection,
          '인물·정당·기관 선택이 올바르지 않습니다.',
        );
      }
    }

    if (regionCodes.size > 0) {
      const regions = await this.currentEntityManager().find(RegionSchema, {
        code: { $in: [...regionCodes] },
      });
      if (regions.length !== regionCodes.size) {
        throw new OnboardingException(
          OnboardingExceptionCode.InvalidSelection,
          '관심 지역 선택이 올바르지 않습니다.',
        );
      }
    }

    return { categoryCodes: categoryRows.map((row) => row.code as CategoryCode) };
  }

  private async loadCategoryResiduals(userId: string): Promise<readonly CategoryResidualRow[]> {
    const entityManager = this.currentEntityManager();
    const categoryPreferences = (await entityManager.find(UserCategoryPreferenceSchema, {
      userId,
    })) as readonly CategoryPreferenceRow[];
    const contributions = (await entityManager.find(UserIssueContributionSchema, {
      userId,
    })) as readonly ContributionRow[];
    return deriveCategoryResiduals(categoryPreferences, contributions);
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

    const entityManager = this.currentEntityManager();
    await entityManager.nativeDelete(UserCategoryPreferenceSchema, { userId });
    const rows = [...categoryCodes].sort().map((categoryCode) => ({
      userCategoryPreferencesId: generateUuidV7(),
      userId,
      categoryCode,
      weight: (actionWeights.get(categoryCode) ?? 0) + (selected.has(categoryCode) ? 2 : 0),
    }));
    if (rows.length > 0) {
      await entityManager.insertMany(UserCategoryPreferenceSchema, rows);
    }
  }

  private async replaceEntityPreferences(
    userId: string,
    entityIds: readonly string[],
  ): Promise<void> {
    const entityManager = this.currentEntityManager();
    await entityManager.nativeDelete(UserEntityPreferenceSchema, { userId });
    const rows = entityIds.map((entityId) => ({
      userEntityPreferenceId: generateUuidV7(),
      userId,
      entityId,
      weight: 2,
    }));
    if (rows.length > 0) {
      await entityManager.insertMany(UserEntityPreferenceSchema, rows);
    }
  }

  private async replaceRegionPreferences(
    userId: string,
    regionCodes: readonly string[],
  ): Promise<void> {
    const entityManager = this.currentEntityManager();
    await entityManager.nativeDelete(UserRegionPreferenceSchema, { userId });
    const rows = regionCodes.map((regionCode) => ({
      id: generateUuidV7(),
      userId,
      regionCode,
      weight: 1,
    }));
    if (rows.length > 0) {
      await entityManager.insertMany(UserRegionPreferenceSchema, rows);
    }
  }

  private async findUser(
    userId: string,
    lock: boolean,
  ): Promise<UserPersistenceEntity | undefined> {
    const user = await this.currentEntityManager().findOne(
      UserSchema,
      { id: userId },
      lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    );
    return user ?? undefined;
  }

  private async findSnapshot(userId: string): Promise<SnapshotData | undefined> {
    const entityManager = this.currentEntityManager();
    const user = await entityManager.findOne(UserSchema, { id: userId });
    if (user === null) return undefined;

    const categoryPreferences = (await entityManager.find(UserCategoryPreferenceSchema, {
      userId,
    })) as readonly CategoryPreferenceRow[];
    const entityPreferences = (await entityManager.find(UserEntityPreferenceSchema, {
      userId,
    })) as readonly EntityPreferenceRow[];
    const regionPreferences = (await entityManager.find(UserRegionPreferenceSchema, {
      userId,
    })) as readonly RegionPreferenceRow[];
    const contributions = (await entityManager.find(UserIssueContributionSchema, {
      userId,
    })) as readonly ContributionRow[];
    const categoryResiduals = deriveCategoryResiduals(categoryPreferences, contributions);

    const topicCandidates = categoryResiduals.filter((row) => categoryResidual(row) === 2);
    const topicCategories =
      topicCandidates.length === 0
        ? []
        : await entityManager.find(IssueCategorySchema, {
            code: { $in: topicCandidates.map((row) => row.category_code) },
          });
    const topicCategoryOrder = new Map(
      topicCategories.map((category) => [category.code, category.displayOrder]),
    );
    const topicCodes = topicCandidates
      .filter((row) => topicCategoryOrder.has(row.category_code))
      .sort((left, right) => {
        const orderDifference =
          (topicCategoryOrder.get(left.category_code) ?? Number.MAX_SAFE_INTEGER) -
          (topicCategoryOrder.get(right.category_code) ?? Number.MAX_SAFE_INTEGER);
        return orderDifference !== 0
          ? orderDifference
          : left.category_code.localeCompare(right.category_code);
      })
      .map((row) => row.category_code);

    return {
      user,
      categoryPreferences,
      entityPreferences,
      regionPreferences,
      categoryResiduals,
      topicCodes,
      entityIds: entityPreferences
        .filter((preference) => numeric(preference.weight) > 0)
        .map((preference) => preference.entityId)
        .sort(),
    };
  }

  private async requireSnapshot(userId: string): Promise<OnboardingStateWithPreferences> {
    const snapshot = await this.findSnapshot(userId);
    if (snapshot === undefined) {
      throw this.userNotFound();
    }
    return this.toSnapshot(snapshot);
  }

  private toSnapshot(snapshot: SnapshotData): OnboardingStateWithPreferences {
    const anomalies = snapshot.categoryResiduals
      .filter((row) => !isAllowedCategoryResidual(categoryResidual(row)))
      .map(toSelectionDerivationAnomaly);
    if (anomalies.length > 0) {
      throw this.selectionDerivationAnomaly(snapshot.user.id, anomalies);
    }

    const preferences: OnboardingPreferenceSnapshot = {
      topicWeights: toWeightObject(snapshot.categoryPreferences, 'categoryCode'),
      entityWeights: toWeightObject(snapshot.entityPreferences, 'entityId'),
      regionWeights: toWeightObject(snapshot.regionPreferences, 'regionCode'),
    };

    return {
      userId: snapshot.user.id as OnboardingStateWithPreferences['userId'],
      status: snapshot.user.onboardingStatus as OnboardingStateWithPreferences['status'],
      completedAt: snapshot.user.onboardingCompletedAt,
      topicCodes: snapshot.topicCodes,
      entityIds: snapshot.entityIds,
      ageGroup: snapshot.user.ageGroup as OnboardingStateWithPreferences['ageGroup'],
      regionCodes: snapshot.regionPreferences.map((preference) => preference.regionCode).sort(),
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
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeLikePrefix(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function toWeightObject(
  rows: readonly CategoryPreferenceRow[],
  key: 'categoryCode',
): Record<string, number>;
function toWeightObject(
  rows: readonly EntityPreferenceRow[],
  key: 'entityId',
): Record<string, number>;
function toWeightObject(
  rows: readonly RegionPreferenceRow[],
  key: 'regionCode',
): Record<string, number>;
function toWeightObject(
  rows: readonly (CategoryPreferenceRow | EntityPreferenceRow | RegionPreferenceRow)[],
  key: 'categoryCode' | 'entityId' | 'regionCode',
): Record<string, number> {
  return Object.fromEntries(
    rows.map((row) => [
      String((row as unknown as Record<string, unknown>)[key]),
      numeric(row.weight),
    ]),
  );
}

function deriveCategoryResiduals(
  categoryPreferences: readonly CategoryPreferenceRow[],
  contributions: readonly ContributionRow[],
): readonly CategoryResidualRow[] {
  const totals = new Map<string, { aggregateWeight: number; actionWeight: number }>();

  for (const preference of categoryPreferences) {
    const current = totals.get(preference.categoryCode) ?? { aggregateWeight: 0, actionWeight: 0 };
    current.aggregateWeight += numeric(preference.weight);
    totals.set(preference.categoryCode, current);
  }
  for (const contribution of contributions) {
    const current = totals.get(contribution.categoryCode) ?? {
      aggregateWeight: 0,
      actionWeight: 0,
    };
    current.actionWeight += numeric(contribution.actionScore) + numeric(contribution.dwellScore);
    totals.set(contribution.categoryCode, current);
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([categoryCode, weights]) => ({
      category_code: categoryCode as CategoryCode,
      aggregate_weight: weights.aggregateWeight,
      action_weight: weights.actionWeight,
    }));
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
