import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  AgeGroup,
  OnboardingException,
  OnboardingExceptionCode,
  OnboardingStatus,
  PostgresOnboardingRepository,
  generateUuidV7,
} from '@newtine/core';
import { CATEGORY_CATALOG } from '@newtine/core/common/category/category.catalog.js';
import {
  IssueCategorySchema,
  OnboardingEntitySchema,
  RegionSchema,
  UserCategoryPreferenceSchema,
  UserEntityPreferenceSchema,
  UserRegionPreferenceSchema,
} from '@newtine/core/onboarding/persistence/onboarding.persistence.entity.js';
import { UserIssueContributionSchema } from '@newtine/core/interest/persistence/interest.persistence.entity.js';
import { UserSchema } from '@newtine/core/user/persistence/user.persistence.entity.js';

type CategoryResidual = {
  category_code: string;
  aggregate_weight: number;
  action_weight: number;
};

type FakeState = {
  status: string;
  ageGroup: string | null;
  completedAt: Date | null;
  hasPrefs?: boolean;
  categoryResiduals?: readonly CategoryResidual[];
  actionWeights?: Record<string, number>;
  categoryWeights?: Record<string, number>;
  entityWeights?: Record<string, number>;
  regionWeights?: Record<string, number>;
  calls: string[];
  searchWhere?: unknown;
};

type FakeFindWhere = {
  code?: { $in?: readonly string[] };
  id?: { $in?: readonly string[] };
};

type FakeUserUpdate = {
  onboardingStatus: string;
  ageGroup: string | null;
  onboardingCompletedAt: Date | null;
};

function createRepository(state: FakeState) {
  const userId = generateUuidV7();
  const entityId = generateUuidV7();
  const topicOrder = new Map<string, number>(
    CATEGORY_CATALOG.map((topic) => [topic.code, topic.displayOrder]),
  );
  const userRecord = {
    id: userId,
    email: null,
    passwordHash: null,
    role: 'USER',
    onboardingStatus: state.status,
    onboardingCompletedAt: state.completedAt,
    ageGroup: state.ageGroup,
    createdAt: new Date('2026-09-13T00:00:00.000Z'),
  };

  const entityManager = {
    getContext: () => entityManager,
    findOne: async (
      schema: unknown,
      _where: unknown,
      options?: { lockMode?: unknown; refresh?: boolean },
    ) => {
      if (schema !== UserSchema) return null;
      state.calls.push(options?.lockMode === undefined ? 'findOne:User' : 'findOne:User:locked');
      if (options?.refresh === true) {
        userRecord.onboardingStatus = state.status;
        userRecord.onboardingCompletedAt = state.completedAt;
        userRecord.ageGroup = state.ageGroup;
      }
      return userRecord;
    },
    find: async (schema: unknown, where: FakeFindWhere) => {
      if (schema === UserCategoryPreferenceSchema) {
        state.calls.push('find:UserCategoryPreference');
        return Object.entries(categoryWeights(state)).map(([categoryCode, weight]) => ({
          userCategoryPreferencesId: generateUuidV7(),
          userId,
          categoryCode,
          weight,
        }));
      }
      if (schema === UserEntityPreferenceSchema) {
        state.calls.push('find:UserEntityPreference');
        const weights = state.entityWeights ?? (state.hasPrefs ? { [entityId]: 2 } : {});
        return Object.entries(weights).map(([rowEntityId, weight]) => ({
          userEntityPreferenceId: generateUuidV7(),
          userId,
          entityId: rowEntityId,
          weight,
        }));
      }
      if (schema === UserRegionPreferenceSchema) {
        state.calls.push('find:UserRegionPreference');
        const weights = state.regionWeights ?? (state.hasPrefs ? { SEOUL: 1 } : {});
        return Object.entries(weights).map(([regionCode, weight]) => ({
          id: generateUuidV7(),
          userId,
          regionCode,
          weight,
        }));
      }
      if (schema === UserIssueContributionSchema) {
        state.calls.push('find:UserIssueContribution');
        return Object.entries(actionWeights(state)).map(([categoryCode, actionScore]) => ({
          userId,
          issueId: generateUuidV7(),
          categoryCode,
          actionScore,
          creditedDwellMilliseconds: 0,
          dwellScore: 0,
          lastActionEventId: null,
          updatedAt: new Date('2026-09-13T00:00:00.000Z'),
        }));
      }
      if (schema === IssueCategorySchema) {
        state.calls.push('find:IssueCategory');
        const codes = (where.code?.$in ?? []) as readonly string[];
        return codes.map((code) => ({
          code,
          displayName: code,
          displayOrder: topicOrder.get(code) ?? Number.MAX_SAFE_INTEGER,
          createdAt: new Date('2026-09-13T00:00:00.000Z'),
        }));
      }
      if (schema === OnboardingEntitySchema) {
        state.calls.push('find:OnboardingEntity');
        const ids = (where.id?.$in ?? []) as readonly string[];
        return ids.map((id) => ({
          id,
          name: 'Entity',
          type: 'POLITICIAN',
          subtitle: null,
          aliases: [],
          isActive: true,
          createdAt: new Date('2026-09-13T00:00:00.000Z'),
        }));
      }
      if (schema === RegionSchema) {
        state.calls.push('find:Region');
        const codes = (where.code?.$in ?? []) as readonly string[];
        return codes.map((code) => ({ code, name: code, displayOrder: 1 }));
      }
      throw new Error('Unhandled ORM find in test double');
    },
    findAndCount: async (_schema: unknown, where: unknown) => {
      state.calls.push('findAndCount:OnboardingEntity');
      state.searchWhere = where;
      return [[], 0];
    },
    nativeDelete: async (schema: unknown) => {
      if (schema === UserCategoryPreferenceSchema) {
        state.calls.push('nativeDelete:UserCategoryPreference');
        state.actionWeights = actionWeights(state);
        state.categoryWeights = {};
        state.hasPrefs = false;
        return 1;
      }
      if (schema === UserEntityPreferenceSchema) {
        state.calls.push('nativeDelete:UserEntityPreference');
        state.entityWeights = {};
        return 1;
      }
      if (schema === UserRegionPreferenceSchema) {
        state.calls.push('nativeDelete:UserRegionPreference');
        state.regionWeights = {};
        return 1;
      }
      throw new Error('Unhandled ORM delete in test double');
    },
    insertMany: async (schema: unknown, rows: readonly Record<string, unknown>[]) => {
      if (schema === UserCategoryPreferenceSchema) {
        state.calls.push('insertMany:UserCategoryPreference');
        state.hasPrefs = true;
        state.categoryWeights ??= {};
        for (const row of rows)
          state.categoryWeights[String(row.categoryCode)] = Number(row.weight);
        return rows.map((row) => row.userCategoryPreferencesId);
      }
      if (schema === UserEntityPreferenceSchema) {
        state.calls.push('insertMany:UserEntityPreference');
        state.hasPrefs = true;
        state.entityWeights ??= {};
        for (const row of rows) state.entityWeights[String(row.entityId)] = Number(row.weight);
        return rows.map((row) => row.userEntityPreferenceId);
      }
      if (schema === UserRegionPreferenceSchema) {
        state.calls.push('insertMany:UserRegionPreference');
        state.hasPrefs = true;
        state.regionWeights ??= {};
        for (const row of rows) state.regionWeights[String(row.regionCode)] = Number(row.weight);
        return rows.map((row) => row.id);
      }
      throw new Error('Unhandled ORM insert in test double');
    },
    nativeUpdate: async (
      schema: unknown,
      where: { onboardingStatus?: string },
      data: FakeUserUpdate,
    ) => {
      if (schema !== UserSchema) throw new Error('Unhandled ORM update in test double');
      state.calls.push('nativeUpdate:User');
      if (
        where.onboardingStatus === OnboardingStatus.Pending &&
        state.status !== OnboardingStatus.Pending
      ) {
        return 0;
      }
      state.status = data.onboardingStatus;
      state.ageGroup = data.ageGroup;
      state.completedAt = data.onboardingCompletedAt;
      return 1;
    },
  };

  return {
    userId,
    entityId,
    repository: new PostgresOnboardingRepository(entityManager as never),
  };
}

function categoryWeights(state: FakeState): Record<string, number> {
  if (state.categoryWeights !== undefined) return state.categoryWeights;
  const residuals = state.categoryResiduals ?? (state.hasPrefs ? [defaultResidual()] : []);
  return Object.fromEntries(residuals.map((row) => [row.category_code, row.aggregate_weight]));
}

function actionWeights(state: FakeState): Record<string, number> {
  if (state.actionWeights !== undefined) return state.actionWeights;
  return Object.fromEntries(
    (state.categoryResiduals ?? []).map((row) => [row.category_code, row.action_weight]),
  );
}

function defaultResidual(): CategoryResidual {
  return { category_code: 'housing', aggregate_weight: 2, action_weight: 0 };
}

test('Postgres adapter uses MikroORM APIs for the onboarding persistence flow', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Pending,
    ageGroup: null,
    completedAt: null,
    hasPrefs: false,
    calls: [],
  };
  const { userId, entityId, repository } = createRepository(state);

  const result = await repository.completeOnboarding(userId, {
    topicCodes: ['housing'],
    entityIds: [entityId],
    ageGroup: AgeGroup.Age19To34,
    regionCodes: ['SEOUL'],
  });

  assert.equal(result.status, OnboardingStatus.Completed);
  assert.equal(result.preferences.topicWeights.housing, 2);
  assert.equal(result.preferences.entityWeights[entityId], 2);
  assert.equal(result.preferences.regionWeights.SEOUL, 1);
  assert.deepEqual(result.topicCodes, ['housing']);
  assert.deepEqual(result.entityIds, [entityId]);
  assert.ok(state.calls.includes('findOne:User:locked'));
  assert.ok(state.calls.includes('nativeDelete:UserCategoryPreference'));
  assert.ok(state.calls.includes('nativeDelete:UserEntityPreference'));
  assert.ok(state.calls.includes('nativeDelete:UserRegionPreference'));
  assert.ok(state.calls.includes('insertMany:UserCategoryPreference'));
  assert.ok(state.calls.includes('insertMany:UserEntityPreference'));
  assert.ok(state.calls.includes('insertMany:UserRegionPreference'));
  assert.ok(state.calls.includes('nativeUpdate:User'));
});

test('Postgres adapter treats LIKE wildcards in an entity prefix as literal input', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Pending,
    ageGroup: null,
    completedAt: null,
    calls: [],
  };
  const { repository } = createRepository(state);

  await repository.searchEntities({ query: '100%_', limit: 20, offset: 0 });

  const where = state.searchWhere as { name?: { $ilike?: string } };
  assert.equal(where.name?.$ilike, '100\\%\\_%');
});

test('Postgres adapter overwrites completed preferences and preserves the completion timestamp', async () => {
  const completedAt = new Date('2026-09-13T00:00:00.000Z');
  const state: FakeState = {
    status: OnboardingStatus.Completed,
    ageGroup: AgeGroup.Age19To34,
    completedAt,
    hasPrefs: true,
    calls: [],
  };
  const { userId, entityId, repository } = createRepository(state);

  const result = await repository.completeOnboarding(userId, {
    topicCodes: ['politics'],
    entityIds: [entityId],
    ageGroup: AgeGroup.Age65Plus,
    regionCodes: ['BUSAN'],
  });

  assert.equal(result.status, OnboardingStatus.Completed);
  assert.equal(result.ageGroup, AgeGroup.Age65Plus);
  assert.deepEqual(result.topicCodes, ['politics']);
  assert.deepEqual(result.entityIds, [entityId]);
  assert.equal(state.completedAt?.toISOString(), completedAt.toISOString());
});

test('Postgres adapter preserves action contributions while replacing the onboarding base', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Completed,
    ageGroup: AgeGroup.Age19To34,
    completedAt: new Date('2026-09-13T00:00:00.000Z'),
    hasPrefs: true,
    categoryResiduals: [{ category_code: 'housing', aggregate_weight: 4, action_weight: 2 }],
    calls: [],
  };
  const { userId, repository } = createRepository(state);

  const result = await repository.completeOnboarding(userId, {
    topicCodes: ['politics'],
    entityIds: [],
    ageGroup: AgeGroup.Age35To49,
    regionCodes: [],
  });

  assert.deepEqual(state.categoryWeights, { housing: 2, politics: 2 });
  assert.deepEqual(result.topicCodes, ['politics']);
  assert.equal(result.preferences.topicWeights.housing, 2);
  assert.equal(result.preferences.topicWeights.politics, 2);
  assert.equal(state.actionWeights?.housing, 2);
});

test('Postgres snapshot uses catalog topic order and code-sorted regions', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Completed,
    ageGroup: AgeGroup.Age19To34,
    completedAt: new Date('2026-09-13T00:00:00.000Z'),
    hasPrefs: true,
    categoryWeights: { politics: 2, housing: 2 },
    regionWeights: { SEOUL: 1, BUSAN: 1 },
    calls: [],
  };
  const { userId, repository } = createRepository(state);

  const result = await repository.findOnboarding(userId);

  assert.deepEqual(result?.topicCodes, ['housing', 'politics']);
  assert.deepEqual(result?.regionCodes, ['BUSAN', 'SEOUL']);
});

test('Postgres adapter fails closed on a category residual anomaly', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Completed,
    ageGroup: AgeGroup.Age19To34,
    completedAt: new Date('2026-09-13T00:00:00.000Z'),
    hasPrefs: true,
    categoryResiduals: [{ category_code: 'housing', aggregate_weight: 3, action_weight: 0 }],
    calls: [],
  };
  const { userId, repository } = createRepository(state);

  await assert.rejects(
    repository.completeOnboarding(userId, {
      topicCodes: ['politics'],
      entityIds: [],
      ageGroup: null,
      regionCodes: [],
    }),
    (exception: unknown) =>
      exception instanceof OnboardingException &&
      exception.code === OnboardingExceptionCode.SelectionDerivationAnomaly &&
      exception.diagnostic?.userId === userId &&
      exception.diagnostic.anomalies[0]?.categoryCode === 'housing' &&
      exception.diagnostic.anomalies[0]?.residual === 3,
  );
  assert.equal(state.calls.includes('nativeDelete:UserCategoryPreference'), false);
});

test('Postgres adapter does not expose derived selections for a GET anomaly', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Completed,
    ageGroup: AgeGroup.Age19To34,
    completedAt: new Date('2026-09-13T00:00:00.000Z'),
    hasPrefs: true,
    categoryResiduals: [{ category_code: 'housing', aggregate_weight: 3, action_weight: 0 }],
    calls: [],
  };
  const { userId, repository } = createRepository(state);

  await assert.rejects(
    repository.findOnboarding(userId),
    (exception: unknown) =>
      exception instanceof OnboardingException &&
      exception.code === OnboardingExceptionCode.SelectionDerivationAnomaly &&
      exception.diagnostic?.userId === userId &&
      exception.diagnostic.anomalies[0]?.categoryCode === 'housing' &&
      exception.diagnostic.anomalies[0]?.aggregateWeight === 3,
  );
});

test('Postgres adapter preserves skip as a zero-preference state', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Pending,
    ageGroup: null,
    completedAt: null,
    hasPrefs: false,
    calls: [],
  };
  const { userId, repository } = createRepository(state);

  const result = await repository.skipOnboarding(userId);

  assert.equal(result.status, OnboardingStatus.Skipped);
  assert.equal(result.ageGroup, null);
  assert.deepEqual(result.topicCodes, []);
  assert.deepEqual(result.entityIds, []);
  assert.deepEqual(result.preferences, { topicWeights: {}, entityWeights: {}, regionWeights: {} });
  assert.ok(state.calls.includes('nativeUpdate:User'));
});
