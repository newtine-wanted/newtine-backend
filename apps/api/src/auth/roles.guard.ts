import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthRoleValue } from '@newtine/core';

import { AUTH_ROLES_KEY } from './auth.decorator.js';
import type { AuthenticatedRequest } from './auth.request.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AuthRoleValue[]>(AUTH_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    if (principal === undefined) {
      throw new UnauthorizedException('인증이 필요합니다.');
    }
    if (!requiredRoles.includes(principal.role)) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }
    return true;
  }
}
