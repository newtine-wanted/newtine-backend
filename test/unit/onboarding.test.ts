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
import { toEntitySearchCommand } from '@newtine/api/onboarding/type/onboarding.input.js';

const transactionManager: TransactionManager = {
  execute: async <T>(work: () => Promise<T>) => work(),
};

test('onboarding options expose the approved topic, age, and region catalogs', () => {
  const repository = new InMemoryOnboardingRepository();
  const options = repository.getOptions();

  assert.equal(options.topics.length, 10);
  assert.deepEqual(
    options.topics.map((option) => [option.code, option.name]),
    [
      ['housing', '주거'],
      ['labor', '일자리'],
      ['finance', '세금·금융'],
      ['welfare', '복지·연금'],
      ['education', '교육'],
      ['health', '보건·의료'],
      ['climate', '환경·기후'],
      ['security', '외교·안보'],
      ['local', '지역·교통'],
      ['politics', '정치·사법'],
    ],
  );
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
  assert.deepEqual(result.regionCodes, ['SEOUL']);
});

test('completed onboarding overwrites the selected preferences without accumulating weights', async () => {
  const repository = new InMemoryOnboardingRepository();
  const userId = repository.seedUser();
  const service = new OnboardingService(repository, transactionManager);
  const command = {
    topicCodes: ['politics'],
    entityIds: [],
    ageGroup: null,
    regionCodes: [],
  } as const;

  const first = await service.complete(userId, command);
  const second = await service.complete(userId, {
    topicCodes: ['politics'],
    entityIds: [],
    ageGroup: AgeGroup.Age65Plus,
    regionCodes: ['BUSAN'],
  });

  assert.equal(second.status, OnboardingStatus.Completed);
  assert.notDeepEqual(second.preferences, first.preferences);
  assert.deepEqual(second.topicCodes, ['politics']);
  assert.deepEqual(second.entityIds, []);
  assert.deepEqual(second.regionCodes, ['BUSAN']);
  assert.equal(second.preferences.topicWeights.politics, 2);
  assert.equal(second.preferences.topicWeights.housing, undefined);
  assert.equal(second.preferences.regionWeights.BUSAN, 1);
  assert.equal(second.preferences.regionWeights.SEOUL, undefined);
  assert.equal(second.completedAt?.getTime(), first.completedAt?.getTime());
});

test('derived topic order follows the catalog and region order follows the region code', async () => {
  const repository = new InMemoryOnboardingRepository();
  const userId = repository.seedUser();
  const service = new OnboardingService(repository, transactionManager);

  const result = await service.complete(userId, {
    topicCodes: ['politics', 'housing'],
    entityIds: [],
    ageGroup: null,
    regionCodes: ['SEOUL', 'BUSAN'],
  });

  assert.deepEqual(result.topicCodes, ['housing', 'politics']);
  assert.deepEqual(result.regionCodes, ['BUSAN', 'SEOUL']);
});

test('skipped onboarding can be completed later with the submitted selections', async () => {
  const repository = new InMemoryOnboardingRepository();
  const userId = repository.seedUser();
  const service = new OnboardingService(repository, transactionManager);

  const result = await service.skip(userId);
  const retry = await service.complete(userId, {
    topicCodes: ['housing'],
    entityIds: [],
    ageGroup: null,
    regionCodes: ['BUSAN'],
  });

  assert.equal(result.status, OnboardingStatus.Skipped);
  assert.equal(result.completedAt, null);
  assert.deepEqual(result.preferences, { topicWeights: {}, entityWeights: {}, regionWeights: {} });
  assert.equal(retry.status, OnboardingStatus.Completed);
  assert.notEqual(retry.completedAt, null);
  assert.deepEqual(retry.topicCodes, ['housing']);
  assert.deepEqual(retry.regionCodes, ['BUSAN']);
  assert.equal(retry.preferences.topicWeights.housing, 2);
  assert.equal(retry.preferences.regionWeights.BUSAN, 1);
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
      topicCodes: ['housing'],
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

test('entity query mapping preserves the approved boundary', () => {
  const repository = new InMemoryOnboardingRepository();
  const entityId = repository.seedEntity({
    name: '검색 대상',
    type: EntityType.Institution,
    aliases: [],
    isActive: true,
  });
  repository.seedUser();
  const search = repository.searchEntities(toEntitySearchCommand({ query: '검색' }));
  assert.equal(search.total, 1);
  assert.equal(search.items[0]?.id, entityId);
});
