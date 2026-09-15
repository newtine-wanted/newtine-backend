import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  createGuestFeedToken,
  FEED_GUEST_COOKIE_NAME,
  FEED_GUEST_COOKIE_TTL_SECONDS,
  hashGuestFeedToken,
  isGuestFeedToken,
  readGuestFeedToken,
  setGuestFeedCookie,
} from '@newtine/api/issue/guest-feed-cookie.js';

const SECRET = new TextEncoder().encode('guest-feed-test-secret-that-is-long-enough');

test('guest feed token is opaque, URL-safe, and hashed before persistence', () => {
  const token = createGuestFeedToken(SECRET);

  assert.equal(isGuestFeedToken(token), true);
  assert.equal(token.split('.').length, 2);
  assert.match(hashGuestFeedToken(token), /^[0-9a-f]{64}$/);
  assert.equal(hashGuestFeedToken(token), hashGuestFeedToken(token));
});

test('guest feed cookie reader accepts only a server-signed token', () => {
  const token = createGuestFeedToken(SECRET);
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
});

test('guest feed cookie is scoped, HttpOnly, SameSite, and Secure in production', () => {
  const headers: Record<string, string> = {};
  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };

  setGuestFeedCookie(response as never, createGuestFeedToken(SECRET), true);

  assert.match(headers['Set-Cookie'] ?? '', new RegExp(`^${FEED_GUEST_COOKIE_NAME}=`));
  assert.match(headers['Set-Cookie'] ?? '', /Path=\/feed-sessions/);
  assert.match(headers['Set-Cookie'] ?? '', /HttpOnly/);
  assert.match(headers['Set-Cookie'] ?? '', /SameSite=Lax/);
  assert.match(headers['Set-Cookie'] ?? '', new RegExp(`Max-Age=${FEED_GUEST_COOKIE_TTL_SECONDS}`));
  assert.match(headers['Set-Cookie'] ?? '', /Secure/);
});
