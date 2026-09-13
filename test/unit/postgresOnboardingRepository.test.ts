import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { PostgreSqlPlatform } from '@mikro-orm/postgresql';

import {
  AgeGroup,
  OnboardingStatus,
  PostgresOnboardingRepository,
  generateUuidV7,
} from '@newtine/core';

type FakeState = {
  status: string;
  ageGroup: string | null;
  completedAt: Date | null;
  hasPrefs?: boolean;
  calls: string[];
};

function createRepository(state: FakeState) {
  const userId = generateUuidV7();
  const entityId = generateUuidV7();
  const categoryId = generateUuidV7();
  const connection = {
    execute: async (sql: string): Promise<unknown> => {
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
      if (normalized.startsWith('SELECT u.id::text AS id')) {
        return {
          id: userId,
          onboarding_status: state.status,
          onboarding_completed_at: state.completedAt,
          age_group: state.ageGroup,
          topic_weights: state.hasPrefs ? { HOUSING: 2 } : {},
          entity_weights: state.hasPrefs ? { [entityId]: 2 } : {},
          region_weights: state.hasPrefs ? { SEOUL: 1 } : {},
          region_codes: state.hasPrefs ? ['SEOUL'] : [],
        };
      }
      if (normalized.includes('FROM issue_categories WHERE code IN')) {
        return [{ id: categoryId, code: 'HOUSING' }];
      }
      if (normalized.includes('FROM entities WHERE id IN')) {
        return [{ id: entityId }];
      }
      if (normalized.includes('FROM regions WHERE code IN')) {
        return [{ region_code: 'SEOUL' }];
      }
      if (normalized.startsWith('INSERT INTO')) {
        state.hasPrefs = true;
        return { affectedRows: 1 };
      }
      if (normalized.startsWith('UPDATE users')) {
        state.status = normalized.includes("'COMPLETED'")
          ? OnboardingStatus.Completed
          : OnboardingStatus.Skipped;
        state.ageGroup = state.status === OnboardingStatus.Completed ? AgeGroup.Age19To34 : null;
        state.completedAt = state.status === OnboardingStatus.Completed ? new Date() : null;
        return { affectedRows: 1 };
      }
      if (normalized.includes('SELECT c.code, p.weight')) {
        return state.hasPrefs ? [{ code: 'HOUSING', weight: 2 }] : [];
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

test('Postgres adapter locks pending users and applies all onboarding preference increments in one flow', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Pending,
    ageGroup: null,
    completedAt: null,
    hasPrefs: false,
    calls: [],
  };
  const { userId, entityId, repository } = createRepository(state);

  const result = await repository.completeOnboarding(userId, {
    topicCodes: ['HOUSING'],
    entityIds: [entityId],
    ageGroup: AgeGroup.Age19To34,
    regionCodes: ['SEOUL'],
  });

  assert.equal(result.status, OnboardingStatus.Completed);
  assert.equal(result.preferences.topicWeights.HOUSING, 2);
  assert.equal(result.preferences.entityWeights[entityId], 2);
  assert.equal(result.preferences.regionWeights.SEOUL, 1);
  assert.match(state.calls[0] ?? '', /FOR UPDATE/);
  assert.equal(state.calls.filter((sql) => sql.startsWith('INSERT INTO')).length, 3);
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

test('Postgres adapter returns terminal snapshots without validating or incrementing a retry', async () => {
  const state: FakeState = {
    status: OnboardingStatus.Completed,
    ageGroup: AgeGroup.Age19To34,
    completedAt: new Date('2026-09-13T00:00:00.000Z'),
    hasPrefs: true,
    calls: [],
  };
  const { userId, entityId, repository } = createRepository(state);

  const result = await repository.completeOnboarding(userId, {
    topicCodes: ['MEDIA'],
    entityIds: [entityId],
    ageGroup: AgeGroup.Age65Plus,
    regionCodes: ['BUSAN'],
  });

  assert.equal(result.status, OnboardingStatus.Completed);
  assert.equal(result.ageGroup, AgeGroup.Age19To34);
  assert.equal(state.calls.filter((sql) => sql.startsWith('INSERT INTO')).length, 0);
  assert.equal(
    state.calls.some((sql) => sql.includes('FROM issue_categories WHERE code IN')),
    false,
  );
});

test('Postgres adapter preserves skip as a terminal zero-preference state', async () => {
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
  assert.deepEqual(result.preferences, { topicWeights: {}, entityWeights: {}, regionWeights: {} });
  assert.equal(state.calls.filter((sql) => sql.startsWith('INSERT INTO')).length, 0);
  assert.equal(state.calls.filter((sql) => sql.startsWith('UPDATE users')).length, 1);
});
