import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { EntityType, InMemoryOnboardingRepository, generateUuidV7 } from '@newtine/core';
import { MetadataService } from '@newtine/api/metadata/metadata.service.js';
import {
  toMetadataAgeGroups,
  toMetadataCategories,
  toMetadataRegions,
  toPoliticalActorSearchResponse,
} from '@newtine/api/metadata/type/metadata.response.js';

test('metadata catalog exposes categories, age groups, and regions independently', async () => {
  const service = new MetadataService(new InMemoryOnboardingRepository());
  const catalog = await service.getCatalog();

  assert.equal(toMetadataCategories(catalog).length, 10);
  assert.equal(toMetadataAgeGroups(catalog).length, 4);
  assert.equal(toMetadataRegions(catalog).length, 17);
  assert.deepEqual(toMetadataCategories(catalog)[0], {
    code: 'housing',
    name: '주거',
    displayOrder: 1,
  });
});

test('political actor metadata keeps active type-filtered master records', async () => {
  const repository = new InMemoryOnboardingRepository();
  repository.seedEntity({
    id: generateUuidV7(),
    name: '홍길동',
    type: EntityType.Politician,
    aliases: ['홍'],
    isActive: true,
  });
  repository.seedEntity({
    name: '홍길동 연구원',
    type: EntityType.Institution,
    aliases: [],
    isActive: false,
  });
  const service = new MetadataService(repository);

  const result = await service.searchPoliticalActors({
    query: '홍',
    type: EntityType.Politician,
    limit: 20,
    offset: 0,
  });
  const response = toPoliticalActorSearchResponse(result);

  assert.equal(response.total, 1);
  assert.equal(response.items[0]?.name, '홍길동');
  assert.equal(response.items[0]?.type, EntityType.Politician);
  assert.deepEqual(response.items[0]?.aliases, ['홍']);
});
