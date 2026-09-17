import type {
  RateLimitOptions,
  RateLimitRule,
} from '@newtine/api/common/middleware/rateLimit.middleware.js';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_GLOBAL_MAX_REQUESTS = 120;
const DEFAULT_AUTH_MAX_REQUESTS = 10;
const DEFAULT_AUTH_ACCOUNT_MAX_REQUESTS = 5;
const DEFAULT_REFRESH_MAX_REQUESTS = 20;
const DEFAULT_FEED_MAX_REQUESTS = 30;
const DEFAULT_SEARCH_MAX_REQUESTS = 60;
const DEFAULT_MAX_KEYS = 10_000;
const DEFAULT_IDLE_TTL_MS = 120_000;
const DEFAULT_TRUST_PROXY_HOPS = 0;

export function createRateLimitOptions(env: NodeJS.ProcessEnv = process.env): RateLimitOptions {
  const windowMs = readPositiveInteger(env, 'RATE_LIMIT_WINDOW_MS', DEFAULT_WINDOW_MS);
  const globalMaxRequests = readPositiveInteger(
    env,
    'RATE_LIMIT_MAX_REQUESTS',
    DEFAULT_GLOBAL_MAX_REQUESTS,
  );

  return {
    global: rule('global-ip', globalMaxRequests, windowMs),
    overrides: new Map([
      [
        'POST /auth/signup',
        rule(
          'auth-ip',
          readPositiveInteger(env, 'RATE_LIMIT_AUTH_MAX_REQUESTS', DEFAULT_AUTH_MAX_REQUESTS),
          windowMs,
        ),
      ],
      [
        'POST /auth/login',
        rule(
          'auth-ip',
          readPositiveInteger(env, 'RATE_LIMIT_AUTH_MAX_REQUESTS', DEFAULT_AUTH_MAX_REQUESTS),
          windowMs,
        ),
      ],
      [
        'POST /auth/logout',
        rule(
          'auth-ip',
          readPositiveInteger(env, 'RATE_LIMIT_AUTH_MAX_REQUESTS', DEFAULT_AUTH_MAX_REQUESTS),
          windowMs,
        ),
      ],
      [
        'POST /auth/refresh',
        rule(
          'refresh-ip',
          readPositiveInteger(env, 'RATE_LIMIT_REFRESH_MAX_REQUESTS', DEFAULT_REFRESH_MAX_REQUESTS),
          windowMs,
        ),
      ],
      [
        'GET /feed',
        rule(
          'feed-ip',
          readPositiveInteger(env, 'RATE_LIMIT_FEED_MAX_REQUESTS', DEFAULT_FEED_MAX_REQUESTS),
          windowMs,
        ),
      ],
      [
        'POST /issues/search',
        rule(
          'search-ip',
          readPositiveInteger(env, 'RATE_LIMIT_SEARCH_MAX_REQUESTS', DEFAULT_SEARCH_MAX_REQUESTS),
          windowMs,
        ),
      ],
    ]),
    account: rule(
      'auth-account',
      readPositiveInteger(
        env,
        'RATE_LIMIT_AUTH_ACCOUNT_MAX_REQUESTS',
        DEFAULT_AUTH_ACCOUNT_MAX_REQUESTS,
      ),
      windowMs,
    ),
    maxKeys: readPositiveInteger(env, 'RATE_LIMIT_MAX_KEYS', DEFAULT_MAX_KEYS),
    idleTtlMs: readPositiveInteger(env, 'RATE_LIMIT_IDLE_TTL_MS', DEFAULT_IDLE_TTL_MS),
    trustProxyHops: readNonNegativeInteger(
      env,
      'RATE_LIMIT_TRUST_PROXY_HOPS',
      DEFAULT_TRUST_PROXY_HOPS,
    ),
  };
}

function rule(name: string, maxRequests: number, windowMs: number): RateLimitRule {
  return { name, maxRequests, windowMs };
}

function readPositiveInteger(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;

  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function readNonNegativeInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;

  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}
