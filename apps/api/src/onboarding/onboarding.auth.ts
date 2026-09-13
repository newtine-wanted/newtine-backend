import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { isUuidV7 } from '@newtine/core';

export interface AuthenticatedRequest extends Request {
  /** Set by the future authentication guard; never read from body or query. */
  authenticatedUserId?: string;
}

export function requireAuthenticatedUserId(request: AuthenticatedRequest): string {
  const userId = request.authenticatedUserId;
  if (typeof userId !== 'string' || userId.trim() === '' || !isUuidV7(userId)) {
    throw new UnauthorizedException('인증이 필요합니다.');
  }
  return userId;
}
