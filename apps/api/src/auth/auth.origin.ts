import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthOptions } from './auth.options.js';

/**
 * Refresh and logout are cookie-authenticated state changes. Browser Origin
 * is checked when supplied; an absent Origin remains valid for same-site
 * non-browser clients, while SameSite=Lax protects normal browser requests.
 */
export function assertAllowedOrigin(request: Request, options: AuthOptions): void {
  const header = request.headers.origin;
  if (header === undefined) {
    return;
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
