import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  AgeGroup,
  EntityType,
  InMemoryOnboardingRepository,
  OnboardingException,
  OnboardingExceptionCode,
  OnboardingStatus,
  generateUuidV7,
  type TransactionManager,
} from '@newtine/core';
import { OnboardingService } from '@newtine/api/onboarding/onboarding.service.js';
import { requireAuthenticatedUserId } from '@newtine/api/onboarding/onboarding.auth.js';
import { toEntitySearchCommand } from '@newtine/api/onboarding/type/onboarding.input.js';

const transactionManager: TransactionManager = {
  execute: async <T>(work: () => Promise<T>) => work(),
};

test('onboarding options expose the approved topic, age, and region catalogs', () => {
  const repository = new InMemoryOnboardingRepository();
  const options = repository.getOptions();

  assert.equal(options.topics.length, 12);
  assert.equal(options.ageGroups.length, 4);
  assert.equal(options.regions.length, 17);
  assert.deepEqual(
    options.ageGroups.map((option) => option.code),
    [AgeGroup.Age19To34, AgeGroup.Age35To49, AgeGroup.Age50To64, AgeGroup.Age65Plus],
  );
});

test('entity search uses active name prefix and type filtering', () => {
  const repository = new InMemoryOnboardingRepository();
  repository.seedEntity({
    name: '홍길동',
    type: EntityType.Politician,
    aliases: [],
    isActive: true,
  });
  repository.seedEntity({ name: '홍길동당', type: EntityType.Party, aliases: [], isActive: true });
  repository.seedEntity({
    name: '홍길동 연구원',
    type: EntityType.Institution,
    aliases: [],
    isActive: false,
  });

  const result = repository.searchEntities({
    query: '홍길',
    type: EntityType.Politician,
    limit: 20,
    offset: 0,
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.name, '홍길동');
});

test('complete atomically applies initial topic/entity +2 and region +1', async () => {
  const repository = new InMemoryOnboardingRepository();
  const userId = repository.seedUser();
  const entityId = repository.seedEntity({
    name: '테스트 기관',
    type: EntityType.Institution,
    aliases: [],
    isActive: true,
  });
  const service = new OnboardingService(repository, transactionManager);

  const result = await service.complete(userId, {
    topicCodes: ['HOUSING'],
    entityIds: [entityId],
    ageGroup: AgeGroup.Age19To34,
    regionCodes: ['SEOUL'],
  });

  assert.equal(result.status, OnboardingStatus.Completed);
  assert.equal(result.preferences.topicWeights.HOUSING, 2);
  assert.equal(result.preferences.entityWeights[entityId], 2);
  assert.equal(result.preferences.regionWeights.SEOUL, 1);
  assert.deepEqual(result.regionCodes, ['SEOUL']);
});

test('terminal retries return the stored result without applying weights again', async () => {
  const repository = new InMemoryOnboardingRepository();
  const userId = repository.seedUser();
  const service = new OnboardingService(repository, transactionManager);
  const command = {
    topicCodes: ['MEDIA'],
    entityIds: [],
    ageGroup: null,
    regionCodes: [],
  } as const;

  const first = await service.complete(userId, command);
  const second = await service.complete(userId, command);

  assert.equal(second.status, OnboardingStatus.Completed);
  assert.deepEqual(second.preferences, first.preferences);
  assert.equal(second.completedAt?.getTime(), first.completedAt?.getTime());
});

test('skip discards the pending onboarding draft and remains terminal', async () => {
  const repository = new InMemoryOnboardingRepository();
  const userId = repository.seedUser();
  const service = new OnboardingService(repository, transactionManager);

  const result = await service.skip(userId);
  const retry = await service.complete(userId, {
    topicCodes: ['HOUSING'],
    entityIds: [],
    ageGroup: null,
    regionCodes: ['BUSAN'],
  });

  assert.equal(result.status, OnboardingStatus.Skipped);
  assert.equal(result.completedAt, null);
  assert.deepEqual(result.preferences, { topicWeights: {}, entityWeights: {}, regionWeights: {} });
  assert.deepEqual(retry.preferences, result.preferences);
  assert.equal(retry.status, OnboardingStatus.Skipped);
});

test('complete rejects invalid selections and unknown users without changing state', async () => {
  const repository = new InMemoryOnboardingRepository();
  const userId = repository.seedUser();
  const service = new OnboardingService(repository, transactionManager);

  await assert.rejects(
    service.complete(userId, {
      topicCodes: [],
      entityIds: [],
      ageGroup: null,
      regionCodes: [],
    }),
    (exception: unknown) =>
      exception instanceof OnboardingException &&
      exception.code === OnboardingExceptionCode.InvalidSelection,
  );
  await assert.rejects(
    service.complete(userId, {
      topicCodes: ['HOUSING'],
      entityIds: [],
      ageGroup: 'AGE_UNKNOWN' as never,
      regionCodes: [],
    }),
    (exception: unknown) =>
      exception instanceof OnboardingException &&
      exception.code === OnboardingExceptionCode.InvalidSelection,
  );
  await assert.rejects(
    service.skip(generateUuidV7()),
    (exception: unknown) =>
      exception instanceof OnboardingException &&
      exception.code === OnboardingExceptionCode.UserNotFound,
  );
  assert.equal(repository.findOnboarding(userId)?.status, OnboardingStatus.Pending);
});

test('entity query mapping and principal seam preserve the approved boundaries', () => {
  const repository = new InMemoryOnboardingRepository();
  const entityId = repository.seedEntity({
    name: '검색 대상',
    type: EntityType.Institution,
    aliases: [],
    isActive: true,
  });
  const userId = repository.seedUser();
  const search = repository.searchEntities(toEntitySearchCommand({ query: '검색' }));
  assert.equal(search.total, 1);
  assert.equal(search.items[0]?.id, entityId);

  assert.throws(() => requireAuthenticatedUserId({} as never), /인증이 필요합니다/);
  assert.equal(requireAuthenticatedUserId({ authenticatedUserId: userId } as never), userId);
});
