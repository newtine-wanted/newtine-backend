import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import type { FeedOwner } from '@newtine/core';

export const FEED_CURSOR_TTL_SECONDS = 24 * 60 * 60;
const FEED_CURSOR_VERSION = 1;
const FUTURE_SKEW_SECONDS = 60;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;

export interface FeedCursorClaims {
  version: 1;
  sessionId: string;
  nextBatchNo: number;
  issuedAt: number;
  expiresAt: number;
  owner: FeedOwner;
}

export interface FeedCursorInput {
  sessionId: string;
  nextBatchNo: number;
  owner: FeedOwner;
  expiresAt: Date;
}

export class FeedCursorError extends Error {
  constructor(readonly kind: 'INVALID' | 'EXPIRED') {
    super(kind === 'EXPIRED' ? 'feed cursor expired' : 'invalid feed cursor');
    this.name = FeedCursorError.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The existing JWT secret is already required to contain at least 32 UTF-8
 * bytes. A domain-separated HMAC derives a dedicated AES key so cursor
 * encryption never reuses the JWT signing primitive directly.
 */
export function createFeedCursor(
  secret: Uint8Array,
  input: FeedCursorInput,
  now: Date = new Date(),
): string {
  const issuedAt = unixSeconds(now);
  const expiresAt = Math.floor(input.expiresAt.getTime() / 1000);
  validatePosition(input.sessionId, input.nextBatchNo);
  validateLifetime(issuedAt, expiresAt);

  const claims = {
    v: FEED_CURSOR_VERSION,
    sid: input.sessionId,
    bn: input.nextBatchNo,
    iat: issuedAt,
    exp: expiresAt,
    o: encodeOwner(input.owner),
  };
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveCursorKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(claims), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `fc1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

export function readFeedCursor(
  token: string,
  secret: Uint8Array,
  now: Date = new Date(),
): FeedCursorClaims {
  try {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'fc1') throw new FeedCursorError('INVALID');
    const iv = decodeBase64url(parts[1]!, IV_LENGTH);
    const ciphertext = decodeBase64url(parts[2]);
    const tag = decodeBase64url(parts[3]!, AUTH_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', deriveCursorKey(secret), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
    const value: unknown = JSON.parse(plaintext);
    if (!isRecord(value)) throw new FeedCursorError('INVALID');

    const version = value.v;
    const sessionId = value.sid;
    const nextBatchNo = value.bn;
    const issuedAt = value.iat;
    const expiresAt = value.exp;
    const owner = decodeOwner(value.o);
    if (
      version !== FEED_CURSOR_VERSION ||
      typeof sessionId !== 'string' ||
      !UUID_PATTERN.test(sessionId) ||
      typeof nextBatchNo !== 'number' ||
      !Number.isSafeInteger(nextBatchNo) ||
      nextBatchNo < 0 ||
      typeof issuedAt !== 'number' ||
      !Number.isSafeInteger(issuedAt) ||
      typeof expiresAt !== 'number' ||
      !Number.isSafeInteger(expiresAt) ||
      owner === undefined
    ) {
      throw new FeedCursorError('INVALID');
    }

    const nowSeconds = unixSeconds(now);
    if (issuedAt > nowSeconds + FUTURE_SKEW_SECONDS) throw new FeedCursorError('INVALID');
    validateLifetime(issuedAt, expiresAt);
    if (expiresAt <= nowSeconds) throw new FeedCursorError('EXPIRED');
    return {
      version: 1,
      sessionId,
      nextBatchNo,
      issuedAt,
      expiresAt,
      owner,
    };
  } catch (error) {
    if (error instanceof FeedCursorError) throw error;
    throw new FeedCursorError('INVALID');
  }
}

export function feedCursorOwnerMatches(claims: FeedCursorClaims, owner: FeedOwner): boolean {
  if (claims.owner.kind !== owner.kind) return false;
  return claims.owner.kind === 'MEMBER'
    ? owner.kind === 'MEMBER' && claims.owner.userId === owner.userId
    : owner.kind === 'GUEST' && claims.owner.guestTokenHash === owner.guestTokenHash;
}

function deriveCursorKey(secret: Uint8Array): Buffer {
  return createHmac('sha256', secret).update('newtine/feed-cursor/aes-256-gcm', 'utf8').digest();
}

function encodeOwner(owner: FeedOwner): string {
  return owner.kind === 'MEMBER'
    ? `m:${owner.userId.toLowerCase()}`
    : `g:${owner.guestTokenHash.toLowerCase()}`;
}

function decodeOwner(value: unknown): FeedOwner | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('m:') && UUID_PATTERN.test(value.slice(2))) {
    return { kind: 'MEMBER', userId: value.slice(2).toLowerCase() };
  }
  if (value.startsWith('g:') && HASH_PATTERN.test(value.slice(2))) {
    return { kind: 'GUEST', guestTokenHash: value.slice(2).toLowerCase() };
  }
  return undefined;
}

function validatePosition(sessionId: string, nextBatchNo: number): void {
  if (!UUID_PATTERN.test(sessionId) || !Number.isSafeInteger(nextBatchNo) || nextBatchNo < 0) {
    throw new FeedCursorError('INVALID');
  }
}

function validateLifetime(issuedAt: number, expiresAt: number): void {
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > FEED_CURSOR_TTL_SECONDS + FUTURE_SKEW_SECONDS
  ) {
    throw new FeedCursorError('INVALID');
  }
}

function decodeBase64url(value: string | undefined, expectedLength?: number): Buffer {
  if (value === undefined || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new FeedCursorError('INVALID');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new FeedCursorError('INVALID');
  }
  return decoded;
}

function unixSeconds(value: Date): number {
  const seconds = Math.floor(value.getTime() / 1000);
  if (!Number.isSafeInteger(seconds)) throw new FeedCursorError('INVALID');
  return seconds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
