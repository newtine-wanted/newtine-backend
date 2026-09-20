import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { PostgreSqlPlatform } from '@mikro-orm/postgresql';

import {
  AgeGroup,
  OnboardingException,
  OnboardingExceptionCode,
  OnboardingStatus,
  PostgresOnboardingRepository,
  generateUuidV7,
} from '@newtine/core';

type FakeState = {
  status: string;
  ageGroup: string | null;
  completedAt: Date | null;
  hasPrefs?: boolean;
  categoryResiduals?: readonly {
    category_code: string;
    aggregate_weight: number;
    action_weight: number;
  }[];
  actionWeights?: Record<string, number>;
  categoryWeights?: Record<string, number>;
  entityWeights?: Record<string, number>;
  regionWeights?: Record<string, number>;
  calls: string[];
};

function createRepository(state: FakeState) {
  const userId = generateUuidV7();
  const entityId = generateUuidV7();
  const connection = {
    execute: async (sql: string, params: unknown[] = []): Promise<unknown> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      state.calls.push(normalized);

      if (normalized.startsWith('SELECT id::text AS id, onboarding_status')) {
        return {
          id: userId,
          onboarding_status: state.status,
          onboarding_completed_at: state.completedAt,
          age_group: state.ageGroup,
        };
      }
      if (normalized.includes('SELECT u.id::text AS id')) {
        const categoryWeights = state.categoryWeights ?? (state.hasPrefs ? { housing: 2 } : {});
        const entityWeights = state.entityWeights ?? (state.hasPrefs ? { [entityId]: 2 } : {});
        const regionWeights = state.regionWeights ?? (state.hasPrefs ? { SEOUL: 1 } : {});
        const categoryResiduals =
          state.categoryResiduals ??
          (state.hasPrefs
            ? [{ category_code: 'housing', aggregate_weight: 2, action_weight: 0 }]
            : []);
        const anomalyDetails = categoryResiduals
          .filter(
            ({ aggregate_weight, action_weight }) =>
              ![0, 2].includes(aggregate_weight - action_weight),
          )
          .map(({ category_code, aggregate_weight, action_weight }) => ({
            category_code,
            aggregate_weight,
            action_weight,
            residual: aggregate_weight - action_weight,
          }));
        return {
          id: userId,
          onboarding_status: state.status,
          onboarding_completed_at: state.completedAt,
          age_group: state.ageGroup,
          topic_weights: categoryWeights,
          entity_weights: entityWeights,
          region_weights: regionWeights,
          region_codes: Object.keys(regionWeights),
          topic_codes: categoryResiduals
            .filter(({ aggregate_weight, action_weight }) => aggregate_weight - action_weight === 2)
            .map(({ category_code }) => category_code),
          selection_anomaly_details: anomalyDetails,
          entity_ids: Object.entries(entityWeights)
            .filter(([, weight]) => weight > 0)
            .map(([id]) => id),
          selection_anomaly: categoryResiduals.some(
            ({ aggregate_weight, action_weight }) =>
              ![0, 2].includes(aggregate_weight - action_weight),
          ),
        };
      }
      if (normalized.includes('FROM issue_categories WHERE code IN')) {
        const topicCodes = Array.isArray(params[0]) ? params[0] : ['housing'];
        return topicCodes.map((code) => ({ code }));
      }
      if (normalized.includes('FROM entities WHERE id IN')) {
        return [{ id: entityId }];
      }
      if (normalized.includes('FROM regions WHERE code IN')) {
        const regionCodes = Array.isArray(params[0]) ? params[0] : ['SEOUL'];
        return regionCodes.map((regionCode) => ({ region_code: regionCode }));
      }
      if (normalized.includes('SELECT category_code, SUM(aggregate_weight)')) {
        return (
          state.categoryResiduals ??
          (state.hasPrefs
            ? [{ category_code: 'housing', aggregate_weight: 2, action_weight: 0 }]
            : [])
        );
      }
      if (normalized.startsWith('DELETE FROM user_category_preferences')) {
        const categoryResiduals =
          state.categoryResiduals ??
          (state.hasPrefs
            ? [{ category_code: 'housing', aggregate_weight: 2, action_weight: 0 }]
            : []);
        state.actionWeights = Object.fromEntries(
          categoryResiduals.map(({ category_code, action_weight }) => [
            category_code,
            action_weight,
          ]),
        );
        state.categoryWeights = {};
        state.categoryResiduals = [];
        state.hasPrefs = false;
        return { affectedRows: 1 };
      }
      if (normalized.startsWith('DELETE FROM user_entity_preferences')) {
        state.entityWeights = {};
        return { affectedRows: 1 };
      }
      if (normalized.startsWith('DELETE FROM user_region_preferences')) {
        state.regionWeights = {};
        return { affectedRows: 1 };
      }
      if (normalized.startsWith('INSERT INTO user_category_preferences')) {
        state.hasPrefs = true;
        state.categoryWeights ??= {};
        const categoryCode = String(params[2]);
        const weight = Number(params[3]);
        state.categoryWeights[categoryCode] = weight;
        state.categoryResiduals = [
          ...(state.categoryResiduals ?? []).filter((row) => row.category_code !== categoryCode),
          {
            category_code: categoryCode,
            aggregate_weight: weight,
            action_weight: state.actionWeights?.[categoryCode] ?? 0,
          },
        ];
        return { affectedRows: 1 };
      }
      if (normalized.startsWith('INSERT INTO user_entity_preferences')) {
        state.hasPrefs = true;
        state.entityWeights ??= {};
        state.entityWeights[String(params[2])] = 2;
        return { affectedRows: 1 };
      }
      if (normalized.startsWith('INSERT INTO user_region_preferences')) {
        state.hasPrefs = true;
        state.regionWeights ??= {};
        state.regionWeights[String(params[2])] = 1;
        return { affectedRows: 1 };
      }
      if (normalized.startsWith('INSERT INTO')) {
        state.hasPrefs = true;
        return { affectedRows: 1 };
      }
      if (normalized.startsWith('UPDATE users')) {
        const wasCompleted = state.status === OnboardingStatus.Completed;
        state.status = normalized.includes("'COMPLETED'")
          ? OnboardingStatus.Completed
          : OnboardingStatus.Skipped;
        state.ageGroup =
          state.status === OnboardingStatus.Completed ? (params[0] as string | null) : null;
        state.completedAt =
          state.status === OnboardingStatus.Completed
            ? wasCompleted
              ? state.completedAt
              : new Date()
            : null;
        return { affectedRows: 1 };
      }
      if (normalized.includes('SELECT p.category_code, p.weight')) {
        return state.hasPrefs ? [{ code: 'housing', weight: 2 }] : [];
      }
      if (normalized.includes('SELECT entity_id::text AS entity_id')) {
        return state.hasPrefs ? [{ entity_id: entityId, weight: 2 }] : [];
      }
      if (normalized.includes('SELECT region_code, weight')) {
        return state.hasPrefs ? [{ region_code: 'SEOUL', weight: 1 }] : [];
      }
      if (normalized.includes('SELECT region_code FROM user_region_preferences')) {
        return state.hasPrefs ? [{ region_code: 'SEOUL' }] : [];
      }
      throw new Error(`Unhandled SQL in test double: ${normalized}`);
    },
  };
  const entityManager = {
    getContext: () => entityManager,
    getConnection: () => connection,
    getTransactionContext: () => undefined,
  };

  return {
    userId,
    entityId,
    repository: new PostgresOnboardingRepository(entityManager as never),
  };
}

test('Postgres adapter SQL follows MikroORM placeholder and list formatting rules', () => {
  const platform = new PostgreSqlPlatform();
  const formatted = platform.formatQuery(
    'SELECT id FROM entities WHERE id IN (?) AND type = ?::text',
    [['0199f000-0000-7000-8000-000000000001', '0199f000-0000-7000-8000-000000000002'], 'PARTY'],
  );

  assert.match(formatted, /id IN \('[^']+', '[^']+'\)/);
  assert.match(formatted, /type = 'PARTY'::text/);
  assert.equal(/\$\d+/.test(formatted), false);
});

test('Postgres adapter locks users and replaces all onboarding preferences in one flow', async () => {
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
  assert.match(state.calls[0] ?? '', /FOR UPDATE/);
  assert.ok(state.calls.some((sql) => sql.startsWith('DELETE FROM user_category_preferences')));
  assert.ok(state.calls.some((sql) => sql.startsWith('DELETE FROM user_entity_preferences')));
  assert.ok(state.calls.some((sql) => sql.startsWith('DELETE FROM user_region_preferences')));
  assert.equal(state.calls.filter((sql) => sql.startsWith('INSERT INTO')).length, 3);
  assert.ok(
    state.calls.some(
      (sql) =>
        sql.startsWith('INSERT INTO user_entity_preferences') &&
        sql.includes('(user_entity_preferences_id, user_id, entity_id, weight)'),
    ),
  );
  assert.equal(state.calls.filter((sql) => sql.startsWith('UPDATE users')).length, 1);
  assert.equal(
    state.calls.some((sql) => /\$\d+/.test(sql)),
    false,
  );
});

test('Postgres adapter treats LIKE wildcards in an entity prefix as literal input', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const connection = {
    execute: async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*)')) {
        return { total: 0 };
      }
      return [];
    },
  };
  const entityManager = {
    getContext: () => entityManager,
    getConnection: () => connection,
    getTransactionContext: () => undefined,
  };
  const repository = new PostgresOnboardingRepository(entityManager as never);

  await repository.searchEntities({ query: '100%_', limit: 20, offset: 0 });

  assert.equal(calls[0]?.params[0], '100\\%\\_%');
  assert.equal(calls[1]?.params[0], '100\\%\\_%');
  assert.match(calls[0]?.sql ?? '', /\?/);
  assert.equal(/\$\d+/.test(calls[0]?.sql ?? ''), false);
});

test('Postgres adapter overwrites completed preferences and preserves the completion timestamp', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Completed,
    ageGroup: AgeGroup.Age19To34,
    completedAt: new Date('2026-09-13T00:00:00.000Z'),
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
  assert.ok(state.calls.some((sql) => sql.startsWith('DELETE FROM user_category_preferences')));
  assert.ok(state.calls.some((sql) => sql.startsWith('DELETE FROM user_entity_preferences')));
  assert.ok(state.calls.some((sql) => sql.startsWith('DELETE FROM user_region_preferences')));
  assert.equal(state.completedAt?.toISOString(), '2026-09-13T00:00:00.000Z');
  assert.equal(
    state.calls.some((sql) => sql.includes('FROM issue_categories WHERE code IN')),
    true,
  );
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
  assert.equal(
    state.calls.some((sql) => sql.startsWith('DELETE FROM user_issue_contributions')),
    false,
  );
  assert.equal(
    state.calls.some((sql) => sql.startsWith('DELETE FROM user_interaction_events')),
    false,
  );
});

test('Postgres snapshot query uses catalog topic order and code-sorted regions', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Completed,
    ageGroup: AgeGroup.Age19To34,
    completedAt: new Date('2026-09-13T00:00:00.000Z'),
    hasPrefs: true,
    calls: [],
  };
  const { userId, repository } = createRepository(state);

  await repository.findOnboarding(userId);

  const snapshotQuery = state.calls.find((sql) => sql.includes('SELECT u.id::text AS id'));
  assert.match(
    snapshotQuery ?? '',
    /jsonb_agg\(r\.category_code ORDER BY c\.display_order, r\.category_code\)/,
  );
  assert.match(snapshotQuery ?? '', /jsonb_agg\(p\.region_code ORDER BY p\.region_code\)/);
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
  assert.equal(
    state.calls.some((sql) => sql.startsWith('DELETE FROM user_category_preferences')),
    false,
  );
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
  assert.equal(state.calls.filter((sql) => sql.startsWith('INSERT INTO')).length, 0);
  assert.equal(state.calls.filter((sql) => sql.startsWith('UPDATE users')).length, 1);
});
