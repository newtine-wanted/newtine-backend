import type { Request, Response } from 'express';

import type { AuthOptions } from './auth.options.js';

const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function readRefreshToken(request: Request, options: AuthOptions): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') {
    return undefined;
  }

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== options.cookieName) {
      continue;
    }

    const encodedValue = cookie.slice(separator + 1).trim();
    try {
      const value = decodeURIComponent(encodedValue);
      return REFRESH_TOKEN_PATTERN.test(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function setRefreshCookie(response: Response, token: string, options: AuthOptions): void {
  response.setHeader(
    'Set-Cookie',
    [
      `${options.cookieName}=${encodeURIComponent(token)}`,
      'Path=/auth',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${options.refreshTokenTtlSeconds}`,
      ...(options.cookieSecure ? ['Secure'] : []),
    ].join('; '),
  );
}

export function clearRefreshCookie(response: Response, options: AuthOptions): void {
  response.setHeader(
    'Set-Cookie',
    [
      `${options.cookieName}=`,
      'Path=/auth',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ...(options.cookieSecure ? ['Secure'] : []),
    ].join('; '),
  );
}
