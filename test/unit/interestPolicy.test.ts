import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  detailDwellContribution,
  detailDwellScore,
  interactionActionDelta,
  interactionActionScore,
  type InterestEventType,
} from '@newtine/core';

const actions: readonly InterestEventType[] = ['LIKE', 'SKIP', 'PASS'];

test('interaction scores and transition deltas match the approved current-state policy', () => {
  assert.deepEqual(
    actions.map((action) => interactionActionScore(action)),
    [2, -3, 0],
  );
  assert.equal(interactionActionScore(null), 0);

  const expected: Record<string, number> = {
    'null->LIKE': 2,
    'null->SKIP': -3,
    'null->PASS': 0,
    'LIKE->LIKE': 0,
    'LIKE->SKIP': -5,
    'LIKE->PASS': -2,
    'SKIP->LIKE': 5,
    'SKIP->SKIP': 0,
    'SKIP->PASS': 3,
    'PASS->LIKE': 2,
    'PASS->SKIP': -3,
    'PASS->PASS': 0,
  };
  for (const previous of [null, ...actions] as const) {
    for (const next of actions) {
      assert.equal(
        interactionActionDelta(previous, next),
        expected[`${previous ?? 'null'}->${next}`],
      );
    }
  }
});

test('detail dwell score has exact threshold boundaries and a one point cap', () => {
  assert.equal(detailDwellScore(0), 0);
  assert.equal(detailDwellScore(9_999), 0);
  assert.equal(detailDwellScore(10_000), 0.5);
  assert.equal(detailDwellScore(29_999), 0.5);
  assert.equal(detailDwellScore(30_000), 1);
  assert.equal(detailDwellScore(1_800_000), 1);
});

test('detail dwell contribution aggregates newly accepted time across views', () => {
  assert.deepEqual(detailDwellContribution(0, 0, 15_000), {
    creditedMilliseconds: 15_000,
    dwellScore: 0.5,
  });
  assert.deepEqual(detailDwellContribution(15_000, 0, 20_000), {
    creditedMilliseconds: 30_000,
    dwellScore: 1,
  });
  assert.deepEqual(detailDwellContribution(30_000, 20_000, 15_000), {
    creditedMilliseconds: 30_000,
    dwellScore: 1,
  });
});
