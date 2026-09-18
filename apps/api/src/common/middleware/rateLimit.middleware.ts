import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { canonicalizeEmail } from '@newtine/api/auth/domain/emailAddress.js';

export type RateLimitRule = {
  name: string;
  maxRequests: number;
  windowMs: number;
};

export type RateLimitOptions = {
  global: RateLimitRule;
  overrides: ReadonlyMap<string, RateLimitRule>;
  account: RateLimitRule;
  maxKeys: number;
  idleTtlMs: number;
  trustProxyHops: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAfterSeconds: number;
  retryAfterSeconds: number;
};

export type RateLimitRejectionEvent = {
  ruleName: string;
  method: string;
  path: string;
  requestId?: string;
  limit: number;
  retryAfterSeconds: number;
  activeKeyCount: number;
  evictionCount: number;
};

export type RateLimitObserver = (event: RateLimitRejectionEvent) => void;

type BucketState = {
  tokens: number;
  updatedAtMs: number;
  lastSeenAtMs: number;
};

export type RateLimitClock = () => number;

/**
 * A bounded process-local token bucket. It is intentionally not a distributed
 * quota: on Cloud Run each API instance owns an independent copy.
 */
export class InMemoryRateLimitStore {
  private readonly states = new Map<string, BucketState>();
  private readonly cleanupIntervalMs: number;
  private lastCleanupAtMs = 0;
  private evictions = 0;

  constructor(
    private readonly maxKeys: number,
    private readonly idleTtlMs: number,
  ) {
    assertPositiveInteger(maxKeys, 'maxKeys');
    assertPositiveInteger(idleTtlMs, 'idleTtlMs');
    this.cleanupIntervalMs = Math.max(1_000, Math.min(idleTtlMs, 60_000));
  }

  get size(): number {
    return this.states.size;
  }

  get evictionCount(): number {
    return this.evictions;
  }

  consume(rule: RateLimitRule, key: string, nowMs: number): RateLimitDecision {
    assertRule(rule);
    assertFiniteNumber(nowMs, 'nowMs');

    this.cleanup(nowMs);
    const stateKey = `${rule.name}\u0000${key}`;
    let state = this.states.get(stateKey);
    if (state === undefined) {
      this.evictIfFull();
      state = { tokens: rule.maxRequests, updatedAtMs: nowMs, lastSeenAtMs: nowMs };
      this.states.set(stateKey, state);
    } else {
      this.states.delete(stateKey);
      this.states.set(stateKey, state);
    }

    const effectiveNowMs = Math.max(nowMs, state.updatedAtMs);
    const elapsedMs = effectiveNowMs - state.updatedAtMs;
    const refill = (elapsedMs * rule.maxRequests) / rule.windowMs;
    const tokens = Math.min(rule.maxRequests, state.tokens + refill);
    const allowed = tokens >= 1;
    state.tokens = allowed ? tokens - 1 : tokens;
    state.updatedAtMs = effectiveNowMs;
    state.lastSeenAtMs = effectiveNowMs;

    const refillPerMs = rule.maxRequests / rule.windowMs;
    const waitMs = allowed
      ? (rule.maxRequests - state.tokens) / refillPerMs
      : Math.max(1, (1 - state.tokens) / refillPerMs);

    return {
      allowed,
      limit: rule.maxRequests,
      remaining: allowed ? Math.max(0, Math.floor(state.tokens)) : 0,
      resetAfterSeconds: Math.max(1, Math.ceil(waitMs / 1_000)),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(waitMs / 1_000)),
    };
  }

  private cleanup(nowMs: number): void {
    if (nowMs < this.lastCleanupAtMs || nowMs - this.lastCleanupAtMs < this.cleanupIntervalMs) {
      return;
    }

    for (const [key, state] of this.states) {
      if (nowMs - state.lastSeenAtMs >= this.idleTtlMs) this.states.delete(key);
    }
    this.lastCleanupAtMs = nowMs;
  }

  private evictIfFull(): void {
    if (this.states.size < this.maxKeys) return;

    let oldestKey: string | undefined;
    let oldestAtMs = Number.POSITIVE_INFINITY;
    for (const [key, state] of this.states) {
      if (state.lastSeenAtMs < oldestAtMs) {
        oldestKey = key;
        oldestAtMs = state.lastSeenAtMs;
      }
    }
    if (oldestKey !== undefined) {
      this.states.delete(oldestKey);
      this.evictions += 1;
    }
  }
}

export function createRateLimitMiddleware(
  store: InMemoryRateLimitStore,
  options: RateLimitOptions,
  now: RateLimitClock = Date.now,
  observer?: RateLimitObserver,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (isHealthRequest(request)) {
      next();
      return;
    }

    const clientKey = `ip:${resolveClientIp(request)}`;
    const globalDecision = store.consume(options.global, clientKey, now());
    applyRateLimitHeaders(response, globalDecision);
    if (!globalDecision.allowed) {
      notifyRejection(observer, store, request, options.global, globalDecision);
      writeRateLimitedResponse(response, globalDecision);
      return;
    }

    const override = options.overrides.get(routeKey(request));
    if (override !== undefined) {
      const overrideDecision = store.consume(override, clientKey, now());
      applyRateLimitHeaders(response, overrideDecision);
      if (!overrideDecision.allowed) {
        notifyRejection(observer, store, request, override, overrideDecision);
        writeRateLimitedResponse(response, overrideDecision);
        return;
      }
    }

    next();
  };
}

/**
 * Runs after body parsing so login/signup can also be limited by a hashed
 * canonical account key. The early IP and endpoint buckets still run first.
 */
export function createAuthAccountRateLimitMiddleware(
  store: InMemoryRateLimitStore,
  options: RateLimitOptions,
  now: RateLimitClock = Date.now,
  observer?: RateLimitObserver,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const accountKey = resolveAuthAccountKey(request);
    if (accountKey === undefined) {
      next();
      return;
    }

    const decision = store.consume(options.account, accountKey, now());
    applyRateLimitHeaders(response, decision);
    if (!decision.allowed) {
      notifyRejection(observer, store, request, options.account, decision);
      writeRateLimitedResponse(response, decision);
      return;
    }
    next();
  };
}

export function resolveClientIp(request: Request): string {
  const resolvedIp = request.ip;
  if (typeof resolvedIp === 'string' && resolvedIp.trim().length > 0) {
    return normalizeIp(resolvedIp);
  }

  const remoteAddress = request.socket?.remoteAddress;
  if (typeof remoteAddress !== 'string' || remoteAddress.trim().length === 0) {
    return 'unknown';
  }
  return normalizeIp(remoteAddress);
}

export function applyRateLimitHeaders(response: Response, decision: RateLimitDecision): void {
  response.setHeader('RateLimit-Limit', String(decision.limit));
  response.setHeader('RateLimit-Remaining', String(decision.remaining));
  response.setHeader('RateLimit-Reset', String(decision.resetAfterSeconds));
}

export function writeRateLimitedResponse(response: Response, decision: RateLimitDecision): void {
  response.setHeader('Retry-After', String(decision.retryAfterSeconds));
  response.status(429).type('application/problem+json').json({
    title: 'Too Many Requests',
    status: 429,
    detail: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    code: 'RATE_LIMITED',
  });
}

function notifyRejection(
  observer: RateLimitObserver | undefined,
  store: InMemoryRateLimitStore,
  request: Request,
  rule: RateLimitRule,
  decision: RateLimitDecision,
): void {
  observer?.({
    ruleName: rule.name,
    method: request.method.toUpperCase(),
    path: requestPath(request),
    requestId: readRequestId(request),
    limit: decision.limit,
    retryAfterSeconds: decision.retryAfterSeconds,
    activeKeyCount: store.size,
    evictionCount: store.evictionCount,
  });
}

function resolveAuthAccountKey(request: Request): string | undefined {
  if (
    request.method.toUpperCase() !== 'POST' ||
    (requestPath(request) !== '/api/auth/login' && requestPath(request) !== '/api/auth/signup')
  ) {
    return undefined;
  }

  const body = request.body;
  if (!isRecord(body) || typeof body.email !== 'string') return undefined;

  try {
    const email = canonicalizeEmail(body.email);
    return `account:${createHash('sha256').update(email, 'utf8').digest('hex')}`;
  } catch {
    return undefined;
  }
}

function isHealthRequest(request: Request): boolean {
  return request.method.toUpperCase() === 'GET' && requestPath(request) === '/api/health';
}

function routeKey(request: Request): string {
  return `${request.method.toUpperCase()} ${requestPath(request)}`;
}

function requestPath(request: Request): string {
  const rawPath =
    typeof request.path === 'string' && request.path.length > 0
      ? request.path
      : (typeof request.url === 'string' ? request.url : '/').split('?', 1)[0] || '/';
  return rawPath.length > 1 ? rawPath.replace(/\/+$/, '') || '/' : rawPath;
}

function normalizeIp(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
}

function readRequestId(request: Request): string | undefined {
  const requestId = (request as Request & { requestId?: unknown }).requestId;
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRule(rule: RateLimitRule): void {
  if (rule.name.trim().length === 0) throw new RangeError('rate limit rule name is required');
  assertPositiveInteger(rule.maxRequests, `${rule.name}.maxRequests`);
  assertPositiveInteger(rule.windowMs, `${rule.name}.windowMs`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}
