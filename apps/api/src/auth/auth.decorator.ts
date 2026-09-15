import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthPrincipal, AuthRoleValue } from '@newtine/core';

import type { AuthenticatedRequest } from './auth.request.js';

export const AUTH_ROLES_KEY = 'auth:roles';
export const AUTH_POLICY_KEY = 'auth:policy';

export type AuthPolicyValue = 'required' | 'optional';

export const Roles = (...roles: AuthRoleValue[]) => SetMetadata(AUTH_ROLES_KEY, roles);
export const AuthPolicy = (policy: AuthPolicyValue) => SetMetadata(AUTH_POLICY_KEY, policy);

/** Reads the principal populated by JwtAuthGuard; it never trusts request input. */
export const CurrentUser = createParamDecorator(
  (
    data: { optional?: boolean } | undefined,
    context: ExecutionContext,
  ): AuthPrincipal | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      if (data?.optional === true) return undefined;
      throw new UnauthorizedException('인증이 필요합니다.');
    }
    return request.principal;
  },
);
