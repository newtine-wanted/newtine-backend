import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import {
  checkedRunStatus,
  checkedValidationMode,
  validationModeFor,
  assertTermDefinition,
  assertFollowUpTrack,
} from '@newtine/core/news-pipeline/newsPipeline.policy.js';

test('run states and validation modes reject unsupported runtime values', () => {
  for (const status of ['RUNNING', 'FAILED', 'COMPLETED'])
    assert.equal(checkedRunStatus(status), status);
  for (const mode of ['AI', 'RULES_ONLY', 'TONE']) assert.equal(checkedValidationMode(mode), mode);
  for (const bad of ['', null, undefined, 'running', 'OTHER', true]) {
    assert.throws(() => checkedRunStatus(bad), /INVALID_NEWS_RUN_STATUS/);
    assert.throws(() => checkedValidationMode(bad), /INVALID_NEWS_VALIDATION_MODE/);
  }
  assert.equal(validationModeFor(true), 'TONE');
  assert.equal(validationModeFor(false), 'RULES_ONLY');
  assert.throws(() => validationModeFor('false'), /INVALID_VALIDATION_CONFIG/);
});
test('term definitions must be nonempty strings before persistence', () => {
  assert.doesNotThrow(() => assertTermDefinition({ term: '용어', definition: '설명' }));
  for (const bad of ['', '   ', null, 4]) {
    assert.throws(
      () => assertTermDefinition({ term: bad, definition: '설명' }),
      /INVALID_NEWS_TERM/,
    );
    assert.throws(
      () => assertTermDefinition({ term: '용어', definition: bad }),
      /INVALID_NEWS_TERM/,
    );
  }
});
test('follow-up arrays and expiry are checked in application code', () => {
  const track = {
    keywords: ['지원'],
    knownTitles: [],
    lastCheckedAt: '2026-09-20T00:00:00Z',
    expiresAt: '2026-09-21T00:00:00Z',
  };
  assert.doesNotThrow(() => assertFollowUpTrack(track));
  for (const change of [
    { keywords: {} },
    { knownTitles: '제목' },
    { keywords: [3] },
    { expiresAt: track.lastCheckedAt },
    { expiresAt: 'invalid' },
    { lastCheckedAt: 'invalid' },
    { expiresAt: '2026-09-19T00:00:00Z' },
  ])
    assert.throws(
      () => assertFollowUpTrack({ ...track, ...change }),
      /INVALID_NEWS_FOLLOW_UP_TRACK/,
    );
});
