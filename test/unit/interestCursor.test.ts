import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { generateUuidV7 } from '@newtine/core';
import {
  decodeInterestCursor,
  encodeInterestCursor,
} from '@newtine/api/interest/type/interest.cursor.js';

test('interest cursors round-trip their ordering key and filter', () => {
  const cursor = {
    likedAt: new Date('2026-09-14T12:00:00.000Z'),
    issueId: generateUuidV7(),
    categoryCode: 'housing' as const,
  };

  const encoded = encodeInterestCursor(cursor);
  const decoded = decodeInterestCursor(encoded, 'housing');

  assert.deepEqual(decoded, cursor);
  assert.ok(encoded.length < 512);
});

test('interest cursors reject malformed or mismatched filters', () => {
  assert.throws(() => decodeInterestCursor('not-a-cursor', undefined));
  assert.throws(() =>
    decodeInterestCursor(
      encodeInterestCursor({
        likedAt: new Date('2026-09-14T12:00:00.000Z'),
        issueId: generateUuidV7(),
        categoryCode: 'housing',
      }),
      'labor',
    ),
  );
});
