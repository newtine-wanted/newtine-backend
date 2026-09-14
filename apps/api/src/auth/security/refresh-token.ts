import { createHash, randomBytes } from 'node:crypto';

import { generateUuidV7, type CreateRefreshSessionCommand, type UuidV7 } from '@newtine/core';

import type { AuthOptions } from '../auth.options.js';

export const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface RefreshSessionDraft {
  readonly token: string;
  readonly command: CreateRefreshSessionCommand;
}

export interface RefreshSessionReplacementDraft {
  readonly token: string;
  readonly command: Omit<CreateRefreshSessionCommand, 'userId'>;
}

export function isRefreshToken(token: string | undefined): token is string {
  return token !== undefined && REFRESH_TOKEN_PATTERN.test(token);
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createRefreshSession(
  userId: UuidV7,
  now: Date,
  options: AuthOptions,
): RefreshSessionDraft {
  const token = generateRefreshToken();
  return {
    token,
    command: {
      id: generateUuidV7(),
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(now.getTime() + options.refreshTokenTtlSeconds * 1000),
      createdAt: now,
    },
  };
}

export function createRefreshSessionReplacement(
  now: Date,
  options: AuthOptions,
): RefreshSessionReplacementDraft {
  const token = generateRefreshToken();
  return {
    token,
    command: {
      id: generateUuidV7(),
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(now.getTime() + options.refreshTokenTtlSeconds * 1000),
      createdAt: now,
    },
  };
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
