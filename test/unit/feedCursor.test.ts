import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  createFeedCursor,
  FEED_CURSOR_TTL_SECONDS,
  FeedCursorError,
  feedCursorOwnerMatches,
  readFeedCursor,
} from '@newtine/api/issue/feed-cursor.js';

const SECRET = new TextEncoder().encode('feed-cursor-test-secret-that-is-long-enough');
const SESSION_ID = '00000000-0000-7000-8000-000000000001';
const MEMBER_ID = '00000000-0000-7000-8000-000000000002';
const GUEST_HASH = 'a'.repeat(64);
const NOW = new Date('2026-01-01T00:00:00.000Z');

test('feed cursor encrypts the internal position and round-trips its owner binding', () => {
  const token = createFeedCursor(
    SECRET,
    {
      sessionId: SESSION_ID,
      nextBatchNo: 3,
      owner: { kind: 'MEMBER', userId: MEMBER_ID },
      expiresAt: new Date(NOW.getTime() + FEED_CURSOR_TTL_SECONDS * 1000),
    },
    NOW,
  );

  assert.match(token, /^fc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(token.includes(SESSION_ID), false);
  assert.deepEqual(readFeedCursor(token, SECRET, NOW), {
    version: 1,
    sessionId: SESSION_ID,
    nextBatchNo: 3,
    issuedAt: Math.floor(NOW.getTime() / 1000),
    expiresAt: Math.floor(NOW.getTime() / 1000) + FEED_CURSOR_TTL_SECONDS,
    owner: { kind: 'MEMBER', userId: MEMBER_ID },
  });

  const claims = readFeedCursor(token, SECRET, NOW);
  assert.equal(feedCursorOwnerMatches(claims, { kind: 'MEMBER', userId: MEMBER_ID }), true);
  assert.equal(feedCursorOwnerMatches(claims, { kind: 'MEMBER', userId: SESSION_ID }), false);
  assert.equal(
    feedCursorOwnerMatches(claims, { kind: 'GUEST', guestTokenHash: GUEST_HASH }),
    false,
  );
});

test('feed cursor rejects tampering, expiration, and future-issued tokens', () => {
  const token = createFeedCursor(
    SECRET,
    {
      sessionId: SESSION_ID,
      nextBatchNo: 0,
      owner: { kind: 'GUEST', guestTokenHash: GUEST_HASH },
      expiresAt: new Date(NOW.getTime() + FEED_CURSOR_TTL_SECONDS * 1000),
    },
    NOW,
  );
  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(
    () => readFeedCursor(tampered, SECRET, NOW),
    (error: unknown) => error instanceof FeedCursorError && error.kind === 'INVALID',
  );

  const expiredAt = new Date(NOW.getTime() - (FEED_CURSOR_TTL_SECONDS + 1) * 1000);
  const expired = createFeedCursor(
    SECRET,
    {
      sessionId: SESSION_ID,
      nextBatchNo: 0,
      owner: { kind: 'GUEST', guestTokenHash: GUEST_HASH },
      expiresAt: new Date(expiredAt.getTime() + FEED_CURSOR_TTL_SECONDS * 1000),
    },
    expiredAt,
  );
  assert.throws(
    () => readFeedCursor(expired, SECRET, NOW),
    (error: unknown) => error instanceof FeedCursorError && error.kind === 'EXPIRED',
  );

  const future = new Date(NOW.getTime() + 2 * 60 * 1000);
  const futureToken = createFeedCursor(
    SECRET,
    {
      sessionId: SESSION_ID,
      nextBatchNo: 0,
      owner: { kind: 'GUEST', guestTokenHash: GUEST_HASH },
      expiresAt: new Date(future.getTime() + FEED_CURSOR_TTL_SECONDS * 1000),
    },
    future,
  );
  assert.throws(
    () => readFeedCursor(futureToken, SECRET, NOW),
    (error: unknown) => error instanceof FeedCursorError && error.kind === 'INVALID',
  );
});
