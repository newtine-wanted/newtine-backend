/* global URL, console, fetch, process */

import assert from 'node:assert/strict';

const baseUrl = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:3000');
const origin = baseUrl.origin;
const email = `compose-auth-${Date.now()}@example.com`;
const password = 'correct-horse-battery-staple';

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), init);
  return { response, body: await response.text() };
}

function parseJson(result) {
  assert.notEqual(result.body, '', `expected JSON response for ${result.response.url}`);
  return JSON.parse(result.body);
}

function refreshCookie(result) {
  const setCookies =
    typeof result.response.headers.getSetCookie === 'function'
      ? result.response.headers.getSetCookie()
      : [result.response.headers.get('set-cookie') ?? ''];
  const value = setCookies.find((cookie) => cookie.startsWith('newtine_refresh='));
  assert.ok(value, `refresh cookie missing for ${result.response.url}`);
  assert.match(value, /Path=\/auth/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Lax/);
  assert.match(value, /Secure/);
  const token = value.slice('newtine_refresh='.length).split(';', 1)[0];
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  return token;
}

function cookieHeader(token) {
  return `newtine_refresh=${token}`;
}

async function refresh(token) {
  return request('/auth/refresh', {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookieHeader(token),
    },
  });
}

const signup = await request('/auth/signup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(signup.response.status, 201);
const signupBody = parseJson(signup);
assert.equal(signupBody.tokenType, 'Bearer');
assert.equal(signupBody.expiresIn, 900);
assert.equal(signupBody.user.email, email);
assert.equal(signupBody.user.role, 'USER');
refreshCookie(signup);

const protectedResponse = await request('/me/onboarding', {
  headers: { Authorization: `Bearer ${signupBody.accessToken}` },
});
assert.equal(protectedResponse.response.status, 200);
const onboarding = parseJson(protectedResponse);
assert.equal(onboarding.status, 'PENDING');
assert.equal(onboarding.completedAt, null);
assert.equal(onboarding.ageGroup, null);
assert.deepEqual(onboarding.regionCodes, []);

const feedSessionResponse = await request('/feed-sessions', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    Authorization: `Bearer ${signupBody.accessToken}`,
  },
  body: JSON.stringify({}),
});
assert.equal(feedSessionResponse.response.status, 200);
const feedSession = parseJson(feedSessionResponse);
assert.equal(feedSession.nextBatchNo, 0);
assert.equal(Object.hasOwn(feedSession, 'guestKey'), false);

const feedBatchResponse = await request(`/feed-sessions/${feedSession.sessionId}/batches`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    Authorization: `Bearer ${signupBody.accessToken}`,
  },
  body: JSON.stringify({ batchNo: 0 }),
});
assert.equal(feedBatchResponse.response.status, 200);
const feedBatch = parseJson(feedBatchResponse);
assert.equal(feedBatch.sessionId, feedSession.sessionId);
assert.equal(feedBatch.batchNo, 0);
assert.ok(Array.isArray(feedBatch.items));

const userPipelineResponse = await request('/pipeline/runs', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    Authorization: `Bearer ${signupBody.accessToken}`,
    'idempotency-key': `compose-user-pipeline-${Date.now()}`,
  },
  body: JSON.stringify({ query: '권한 경계 smoke' }),
});
assert.equal(userPipelineResponse.response.status, 403);
assert.equal(parseJson(userPipelineResponse).code, 'FORBIDDEN');

const login = await request('/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `  ${email.toUpperCase()}  `, password }),
});
assert.equal(login.response.status, 200);
const loginBody = parseJson(login);
assert.equal(loginBody.user.id, signupBody.user.id);
const loginCookie = refreshCookie(login);

const rotated = await refresh(loginCookie);
assert.equal(rotated.response.status, 200);
const rotatedBody = parseJson(rotated);
assert.equal(rotatedBody.user.id, signupBody.user.id);
assert.notEqual(rotatedBody.accessToken, loginBody.accessToken);
const rotatedCookie = refreshCookie(rotated);
assert.notEqual(rotatedCookie, loginCookie);

const reused = await refresh(loginCookie);
assert.equal(reused.response.status, 401);
const replacementAfterReuse = await refresh(rotatedCookie);
assert.equal(replacementAfterReuse.response.status, 401);

const freshLogin = await request('/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(freshLogin.response.status, 200);
const freshLoginCookie = refreshCookie(freshLogin);

const logout = await request('/auth/logout', {
  method: 'POST',
  headers: {
    Origin: origin,
    Cookie: cookieHeader(freshLoginCookie),
  },
});
assert.equal(logout.response.status, 204);
assert.equal(logout.body, '');
const clearedCookie =
  logout.response.headers.getSetCookie?.()[0] ?? logout.response.headers.get('set-cookie') ?? '';
assert.match(clearedCookie, /newtine_refresh=;/);
assert.match(clearedCookie, /Max-Age=0/);

const refreshAfterLogout = await refresh(freshLoginCookie);
assert.equal(refreshAfterLogout.response.status, 401);

const idempotentLogout = await request('/auth/logout', {
  method: 'POST',
  headers: { Origin: origin },
});
assert.equal(idempotentLogout.response.status, 204);

console.log(
  'Compose auth smoke passed: migration, signup, protected API, member feed, login, refresh rotation, reuse revoke, and logout',
);
