import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import type { Request, Response } from 'express';

import {
  createAuthAccountRateLimitMiddleware,
  createRateLimitMiddleware,
  InMemoryRateLimitStore,
  resolveClientIp,
  type RateLimitOptions,
  type RateLimitRejectionEvent,
  type RateLimitRule,
} from '@newtine/api/common/middleware/rateLimit.middleware.js';
import { createRateLimitOptions } from '@newtine/api/common/middleware/rateLimit.options.js';

class TestResponse {
  statusCode = 200;
  contentType: string | undefined;
  body: unknown;
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }

  status(status: number): this {
    this.statusCode = status;
    return this;
  }

  type(type: string): this {
    this.contentType = type;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }
}

const globalRule: RateLimitRule = { name: 'global', maxRequests: 2, windowMs: 1_000 };
const accountRule: RateLimitRule = { name: 'account', maxRequests: 1, windowMs: 1_000 };

function options(overrides: ReadonlyMap<string, RateLimitRule> = new Map()): RateLimitOptions {
  return {
    global: globalRule,
    overrides,
    account: accountRule,
    maxKeys: 20,
    idleTtlMs: 10_000,
    trustProxyHops: 0,
  };
}

function request(path: string, ip = '192.0.2.10', method = 'GET', body?: unknown): Request {
  return {
    method,
    path,
    url: path,
    body,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

test('token bucket permits burst, refills, and returns a retry delay', () => {
  const store = new InMemoryRateLimitStore(20, 10_000);

  assert.equal(store.consume(globalRule, 'ip:a', 0).allowed, true);
  assert.equal(store.consume(globalRule, 'ip:a', 0).allowed, true);

  const rejected = store.consume(globalRule, 'ip:a', 0);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.equal(rejected.resetAfterSeconds, 1);
  assert.equal(rejected.retryAfterSeconds, 1);
  assert.equal(store.consume(globalRule, 'ip:a', 500).allowed, true);
  assert.equal(store.consume(globalRule, 'ip:a', 500).allowed, false);
  assert.equal(store.consume(globalRule, 'ip:a', 1_000).allowed, true);
});

test('token bucket state remains bounded and idle entries are cleaned up', () => {
  const store = new InMemoryRateLimitStore(2, 10);

  store.consume(globalRule, 'ip:a', 0);
  store.consume(globalRule, 'ip:b', 0);
  store.consume(globalRule, 'ip:c', 1);
  assert.equal(store.size, 2);

  store.consume(globalRule, 'ip:c', 11_000);
  assert.equal(store.size, 1);
  assert.equal(store.evictionCount, 1);
});

test('global middleware bypasses health and applies an endpoint override', () => {
  const authRule: RateLimitRule = { name: 'auth-ip', maxRequests: 1, windowMs: 1_000 };
  const store = new InMemoryRateLimitStore(20, 10_000);
  const rejections: RateLimitRejectionEvent[] = [];
  const middleware = createRateLimitMiddleware(
    store,
    options(new Map([['POST /auth/login', authRule]])),
    () => 0,
    (event) => rejections.push(event),
  );

  let nextCalls = 0;
  const healthResponse = new TestResponse();
  for (const path of ['/health', '/health', '/health/']) {
    middleware(request(path), healthResponse as unknown as Response, () => {
      nextCalls += 1;
    });
  }
  assert.equal(nextCalls, 3);

  const firstLogin = new TestResponse();
  middleware(
    request('/auth/login', '192.0.2.11', 'POST'),
    firstLogin as unknown as Response,
    () => {
      nextCalls += 1;
    },
  );
  assert.equal(firstLogin.statusCode, 200);
  assert.equal(firstLogin.headers.get('RateLimit-Limit'), '1');

  const rejectedLogin = new TestResponse();
  middleware(
    request('/auth/login', '192.0.2.11', 'POST'),
    rejectedLogin as unknown as Response,
    () => {
      nextCalls += 1;
    },
  );
  assert.equal(rejectedLogin.statusCode, 429);
  assert.equal(rejectedLogin.contentType, 'application/problem+json');
  assert.equal(rejectedLogin.headers.get('Retry-After'), '1');
  assert.deepEqual(rejectedLogin.body, {
    title: 'Too Many Requests',
    status: 429,
    detail: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    code: 'RATE_LIMITED',
  });
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0]?.ruleName, 'auth-ip');
  assert.equal(rejections[0]?.method, 'POST');
  assert.equal(rejections[0]?.path, '/auth/login');
  assert.equal(Object.hasOwn(rejections[0] ?? {}, 'clientIp'), false);
});

test('endpoint overrides also match routes with a trailing slash', () => {
  const authRule: RateLimitRule = { name: 'auth-ip', maxRequests: 1, windowMs: 1_000 };
  const store = new InMemoryRateLimitStore(20, 10_000);
  const middleware = createRateLimitMiddleware(
    store,
    options(new Map([['POST /auth/login', authRule]])),
    () => 0,
  );
  let nextCalls = 0;

  const first = new TestResponse();
  middleware(request('/auth/login', '192.0.2.12', 'POST'), first as unknown as Response, () => {
    nextCalls += 1;
  });
  assert.equal(first.statusCode, 200);

  const trailingSlash = new TestResponse();
  middleware(
    request('/auth/login/', '192.0.2.12', 'POST'),
    trailingSlash as unknown as Response,
    () => {
      nextCalls += 1;
    },
  );
  assert.equal(trailingSlash.statusCode, 429);
  assert.equal(nextCalls, 1);
});

test('account middleware uses the canonical email without storing its raw value', () => {
  const store = new InMemoryRateLimitStore(20, 10_000);
  const middleware = createAuthAccountRateLimitMiddleware(store, options(), () => 0);
  let nextCalls = 0;

  const first = new TestResponse();
  middleware(
    request('/auth/login', '192.0.2.20', 'POST', { email: ' User@example.com ' }),
    first as unknown as Response,
    () => {
      nextCalls += 1;
    },
  );
  assert.equal(first.statusCode, 200);

  const equivalent = new TestResponse();
  middleware(
    request('/auth/login', '192.0.2.21', 'POST', { email: 'user@example.com' }),
    equivalent as unknown as Response,
    () => {
      nextCalls += 1;
    },
  );
  assert.equal(equivalent.statusCode, 429);

  const different = new TestResponse();
  middleware(
    request('/auth/login', '192.0.2.21', 'POST', { email: 'other@example.com' }),
    different as unknown as Response,
    () => {
      nextCalls += 1;
    },
  );
  assert.equal(different.statusCode, 200);
  assert.equal(nextCalls, 2);
  assert.equal(store.size, 2);
});

test('rate limit options expose safe defaults and reject invalid configuration', () => {
  const configured = createRateLimitOptions({
    RATE_LIMIT_WINDOW_MS: '5000',
    RATE_LIMIT_MAX_REQUESTS: '7',
    RATE_LIMIT_MAX_KEYS: '3',
    RATE_LIMIT_TRUST_PROXY_HOPS: '1',
  });
  assert.equal(configured.global.windowMs, 5_000);
  assert.equal(configured.global.maxRequests, 7);
  assert.equal(configured.maxKeys, 3);
  assert.equal(configured.trustProxyHops, 1);
  assert.equal(configured.overrides.get('GET /feed')?.name, 'feed-ip');

  assert.throws(
    () => createRateLimitOptions({ RATE_LIMIT_MAX_REQUESTS: '0' }),
    /RATE_LIMIT_MAX_REQUESTS must be a positive safe integer/,
  );

  assert.throws(
    () => createRateLimitOptions({ RATE_LIMIT_TRUST_PROXY_HOPS: '-1' }),
    /RATE_LIMIT_TRUST_PROXY_HOPS must be a non-negative safe integer/,
  );
});

test('client key uses Express resolved IP and never parses raw forwarded headers', () => {
  const proxiedRequest = request('/health', '10.0.0.1');
  Object.assign(proxiedRequest, {
    ip: '198.51.100.10',
    headers: { 'x-forwarded-for': '203.0.113.9' },
  });

  assert.equal(resolveClientIp(proxiedRequest), '198.51.100.10');
});
