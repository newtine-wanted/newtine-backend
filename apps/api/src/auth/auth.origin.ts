import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthOptions } from './auth.options.js';

export type AuthOriginHeaders = {
  /** Browser Origin; omission is rejected with 403 by the route guard. */
  origin?: string;
};

/**
 * Keep the browser-only Origin requirement visible in generated contracts
 * without turning an absent header into a generic 400. The route guard below
 * remains the source of truth and deliberately returns 403 for missing or
 * disallowed origins.
 */
export const authOriginHeadersValidator = {
  type: 'is' as const,
  is: (input: Record<string, string | string[] | undefined>): AuthOriginHeaders | null => {
    const origin = input.origin;
    if (origin !== undefined && typeof origin !== 'string') return null;
    return { origin };
  },
};

/**
 * Cookie-authenticated state changes require an explicit browser Origin.
 * Non-browser clients are intentionally unsupported by the current auth
 * contract, so an absent Origin is rejected instead of becoming a bypass.
 */
export function assertAllowedOrigin(request: Request, options: AuthOptions): void {
  const header = request.headers.origin;
  if (header === undefined) {
    throw new ForbiddenException('허용되지 않은 origin입니다.');
  }
  if (Array.isArray(header) && header.length !== 1) {
    throw new ForbiddenException('허용되지 않은 origin입니다.');
  }

  const origin = Array.isArray(header) ? header[0] : header;
  if (typeof origin !== 'string' || origin === 'null' || origin.trim() === '') {
    throw new ForbiddenException('허용되지 않은 origin입니다.');
  }

  let normalizedOrigin: string;
  try {
    const parsed = new URL(origin);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
      throw new Error('not an origin');
    }
    normalizedOrigin = parsed.origin;
  } catch {
    throw new ForbiddenException('허용되지 않은 origin입니다.');
  }

  if (options.allowedOrigins.length > 0) {
    if (!options.allowedOrigins.includes(normalizedOrigin)) {
      throw new ForbiddenException('허용되지 않은 origin입니다.');
    }
    return;
  }

  const host = request.get('host');
  const protocol = request.protocol;
  if (typeof host !== 'string' || host.trim() === '') {
    throw new ForbiddenException('허용되지 않은 origin입니다.');
  }
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(`${protocol}://${host}`).origin;
  } catch {
    throw new ForbiddenException('허용되지 않은 origin입니다.');
  }
  if (normalizedOrigin !== expectedOrigin) {
    throw new ForbiddenException('허용되지 않은 origin입니다.');
  }
}
