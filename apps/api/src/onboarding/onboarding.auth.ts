import { UnauthorizedException } from '@nestjs/common';
import { isUuidV7 } from '@newtine/core';

import type { AuthenticatedRequest } from '@newtine/api/auth/auth.request.js';

export type { AuthenticatedRequest } from '@newtine/api/auth/auth.request.js';

/** The guard-owned principal is never read from body or query. */

export function requireAuthenticatedUserId(request: AuthenticatedRequest): string {
  const userId = request.authenticatedUserId;
  if (typeof userId !== 'string' || userId.trim() === '' || !isUuidV7(userId)) {
    throw new UnauthorizedException('인증이 필요합니다.');
  }
  return userId;
}
