import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthPrincipal, AuthRoleValue } from '@newtine/core';

import type { AuthenticatedRequest } from './auth.request.js';

export const AUTH_ROLES_KEY = 'auth:roles';

export const Roles = (...roles: AuthRoleValue[]) => SetMetadata(AUTH_ROLES_KEY, roles);

/** Reads the principal populated by JwtAuthGuard; it never trusts request input. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw new UnauthorizedException('인증이 필요합니다.');
    }
    return request.principal;
  },
);
