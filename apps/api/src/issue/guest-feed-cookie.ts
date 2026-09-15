import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

export const FEED_GUEST_COOKIE_NAME = 'newtine_feed_guest';
export const FEED_GUEST_COOKIE_TTL_SECONDS = 24 * 60 * 60;

const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;

export function createGuestFeedToken(secret: Uint8Array): string {
  const nonce = randomBytes(32).toString('base64url');
  const signature = signGuestFeedNonce(nonce, secret);
  return `${nonce}.${signature}`;
}

export function hashGuestFeedToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function readGuestFeedToken(request: Request, secret: Uint8Array): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return undefined;

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== FEED_GUEST_COOKIE_NAME) {
      continue;
    }

    try {
      const value = decodeURIComponent(cookie.slice(separator + 1).trim());
      return isValidGuestFeedToken(value, secret) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function setGuestFeedCookie(response: Response, token: string, secure: boolean): void {
  response.setHeader(
    'Set-Cookie',
    [
      `${FEED_GUEST_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/feed-sessions',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${FEED_GUEST_COOKIE_TTL_SECONDS}`,
      ...(secure ? ['Secure'] : []),
    ].join('; '),
  );
}

export function isGuestFeedToken(value: string): boolean {
  return GUEST_TOKEN_PATTERN.test(value);
}

function isValidGuestFeedToken(value: string, secret: Uint8Array): boolean {
  if (!isGuestFeedToken(value)) return false;

  const separator = value.indexOf('.');
  const nonce = value.slice(0, separator);
  const providedSignature = Buffer.from(value.slice(separator + 1), 'base64url');
  const expectedSignature = Buffer.from(signGuestFeedNonce(nonce, secret), 'base64url');
  return (
    providedSignature.length === expectedSignature.length &&
    timingSafeEqual(providedSignature, expectedSignature)
  );
}

function signGuestFeedNonce(nonce: string, secret: Uint8Array): string {
  return createHmac('sha256', secret).update(nonce, 'utf8').digest('base64url');
}
