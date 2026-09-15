import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

export const FEED_GUEST_COOKIE_NAME = 'newtine_feed_guest';
export const FEED_GUEST_COOKIE_TTL_SECONDS = 24 * 60 * 60;

const GUEST_TOKEN_PATTERN =
  /^(?:[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}|v1\.\d+\.\d+\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43})$/;
const FUTURE_SKEW_SECONDS = 60;

export interface GuestFeedCredential {
  token: string;
  legacy: boolean;
  issuedAt: number | null;
  expiresAt: number | null;
}

export function createGuestFeedToken(secret: Uint8Array, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + FEED_GUEST_COOKIE_TTL_SECONDS;
  const nonce = randomBytes(32).toString('base64url');
  const payload = `v1.${issuedAt}.${expiresAt}.${nonce}`;
  return `${payload}.${signGuestFeedPayload(payload, secret)}`;
}

export function hashGuestFeedToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function feedGuestOwner(guestTokenHash: string) {
  return { kind: 'GUEST' as const, guestTokenHash: guestTokenHash.toLowerCase() };
}

export function readGuestFeedToken(request: Request, secret: Uint8Array): string | undefined {
  return readGuestFeedCredential(request, secret)?.token;
}

export function readGuestFeedCredential(
  request: Request,
  secret: Uint8Array,
  now: Date = new Date(),
): GuestFeedCredential | undefined {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return undefined;

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== FEED_GUEST_COOKIE_NAME) {
      continue;
    }

    try {
      const value = decodeURIComponent(cookie.slice(separator + 1).trim());
      return readCredential(value, secret, now);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function setGuestFeedCookie(
  response: Response,
  token: string,
  secure: boolean,
  now: Date = new Date(),
): void {
  const expiresAt = timedExpiry(token);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const maxAge =
    expiresAt === null
      ? FEED_GUEST_COOKIE_TTL_SECONDS
      : Math.max(0, Math.min(FEED_GUEST_COOKIE_TTL_SECONDS, expiresAt - nowSeconds));
  response.setHeader(
    'Set-Cookie',
    [
      `${FEED_GUEST_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/feed',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAge}`,
      ...(secure ? ['Secure'] : []),
    ].join('; '),
  );
}

export function isGuestFeedToken(value: string): boolean {
  return GUEST_TOKEN_PATTERN.test(value);
}

function readCredential(
  value: string,
  secret: Uint8Array,
  now: Date,
): GuestFeedCredential | undefined {
  if (!isGuestFeedToken(value)) return undefined;
  const parts = value.split('.');
  const legacy = parts.length === 2;
  const payload = legacy ? parts[0]! : parts.slice(0, 4).join('.');
  const providedSignature = Buffer.from(legacy ? parts[1]! : parts[4]!, 'base64url');
  const expectedSignature = Buffer.from(signGuestFeedPayload(payload, secret), 'base64url');
  return providedSignature.length === expectedSignature.length &&
    timingSafeEqual(providedSignature, expectedSignature) &&
    (legacy ? true : validTimedPayload(parts, now))
    ? {
        token: value,
        legacy,
        issuedAt: legacy ? null : Number(parts[1]),
        expiresAt: legacy ? null : Number(parts[2]),
      }
    : undefined;
}

function signGuestFeedPayload(payload: string, secret: Uint8Array): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

function validTimedPayload(parts: string[], now: Date): boolean {
  if (parts[0] !== 'v1') return false;
  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return (
    Number.isSafeInteger(issuedAt) &&
    Number.isSafeInteger(expiresAt) &&
    issuedAt <= nowSeconds + FUTURE_SKEW_SECONDS &&
    expiresAt > nowSeconds &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt <= FEED_GUEST_COOKIE_TTL_SECONDS + FUTURE_SKEW_SECONDS
  );
}

function timedExpiry(token: string): number | null {
  const parts = token.split('.');
  return parts.length === 5 && parts[0] === 'v1' ? Number(parts[2]) : null;
}
