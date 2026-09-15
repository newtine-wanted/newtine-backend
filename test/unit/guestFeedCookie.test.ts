import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from '@jest/globals';

import {
  createGuestFeedToken,
  FEED_GUEST_COOKIE_NAME,
  FEED_GUEST_COOKIE_TTL_SECONDS,
  hashGuestFeedToken,
  isGuestFeedToken,
  readGuestFeedCredential,
  readGuestFeedToken,
  setGuestFeedCookie,
} from '@newtine/api/issue/guest-feed-cookie.js';

const SECRET = new TextEncoder().encode('guest-feed-test-secret-that-is-long-enough');

test('guest feed token is opaque, URL-safe, and hashed before persistence', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const token = createGuestFeedToken(SECRET, now);

  assert.equal(isGuestFeedToken(token), true);
  assert.equal(token.split('.').length, 5);
  assert.match(hashGuestFeedToken(token), /^[0-9a-f]{64}$/);
  assert.equal(hashGuestFeedToken(token), hashGuestFeedToken(token));
  assert.equal(
    readGuestFeedCredential(
      { headers: { cookie: `newtine_feed_guest=${token}` } } as never,
      SECRET,
      now,
    )?.legacy,
    false,
  );
});

test('guest feed cookie reader accepts only a server-signed token', () => {
  const now = new Date();
  const token = createGuestFeedToken(SECRET, now);
  const request = {
    headers: {
      cookie: `other=value; ${FEED_GUEST_COOKIE_NAME}=${encodeURIComponent(token)}`,
    },
  };

  assert.equal(readGuestFeedToken(request as never, SECRET), token);
  assert.equal(
    readGuestFeedToken(
      { headers: { cookie: `${FEED_GUEST_COOKIE_NAME}=${'A'.repeat(43)}` } } as never,
      SECRET,
    ),
    undefined,
  );
  assert.equal(
    readGuestFeedToken(request as never, new TextEncoder().encode('wrong-secret')),
    undefined,
  );
  assert.equal(readGuestFeedToken({ headers: {} } as never, SECRET), undefined);

  const legacyNonce = 'A'.repeat(43);
  const legacySignature = createHmac('sha256', SECRET)
    .update(legacyNonce, 'utf8')
    .digest('base64url');
  const legacyToken = `${legacyNonce}.${legacySignature}`;
  const legacyCredential = readGuestFeedCredential(
    { headers: { cookie: `${FEED_GUEST_COOKIE_NAME}=${legacyToken}` } } as never,
    SECRET,
    now,
  );
  assert.equal(legacyCredential?.legacy, true);
  assert.equal(legacyCredential?.token, legacyToken);

  const issuedAt = new Date('2026-01-01T00:00:00.000Z');
  const expiredToken = createGuestFeedToken(SECRET, issuedAt);
  const unexpiredCredential = readGuestFeedCredential(
    { headers: { cookie: `${FEED_GUEST_COOKIE_NAME}=${expiredToken}` } } as never,
    SECRET,
    issuedAt,
  );
  assert.equal(unexpiredCredential?.token, expiredToken);
  assert.equal(unexpiredCredential?.legacy, false);
  assert.equal(
    readGuestFeedCredential(
      { headers: { cookie: `${FEED_GUEST_COOKIE_NAME}=${expiredToken}` } } as never,
      SECRET,
      new Date('2026-01-02T00:00:01.000Z'),
    ),
    undefined,
  );
});

test('guest feed cookie is scoped, HttpOnly, SameSite, and Secure in production', () => {
  const headers: Record<string, string> = {};
  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };

  const now = new Date('2026-01-01T00:00:00.000Z');
  setGuestFeedCookie(response as never, createGuestFeedToken(SECRET, now), true, now);

  assert.match(headers['Set-Cookie'] ?? '', new RegExp(`^${FEED_GUEST_COOKIE_NAME}=`));
  assert.match(headers['Set-Cookie'] ?? '', /Path=\/feed/);
  assert.match(headers['Set-Cookie'] ?? '', /HttpOnly/);
  assert.match(headers['Set-Cookie'] ?? '', /SameSite=Lax/);
  assert.match(headers['Set-Cookie'] ?? '', new RegExp(`Max-Age=${FEED_GUEST_COOKIE_TTL_SECONDS}`));
  assert.match(headers['Set-Cookie'] ?? '', /Secure/);
});
