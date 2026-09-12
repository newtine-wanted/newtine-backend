import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Entity, generateUuidV7, isUuidV7 } from '@newtine/core';

test('generateUuidV7 creates a valid UUIDv7', () => {
  const id = generateUuidV7();

  assert.equal(isUuidV7(id), true);
  assert.equal(id[14], '7');
  assert.match(id[19] ?? '', /[89ab]/i);
});

test('generateUuidV7 preserves local ordering for same-millisecond IDs', () => {
  const first = generateUuidV7();
  const second = generateUuidV7();

  assert.ok(first < second);
});

test('Entity generates its persistent identity before persistence', () => {
  class TestEntity extends Entity {
    constructor() {
      super();
    }
  }

  const first = new TestEntity();
  const second = new TestEntity();

  assert.equal(isUuidV7(first.id), true);
  assert.equal(isUuidV7(second.id), true);
  assert.notEqual(first.id, second.id);
});
