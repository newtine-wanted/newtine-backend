import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AUTH_POLICY_KEY, type AuthPolicyValue } from './auth.decorator.js';
import type { AuthenticatedRequest } from './auth.request.js';
import { AccessPrincipalService } from './application/access-principal.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly accessPrincipalService: AccessPrincipalService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const policy =
      this.reflector.getAllAndOverride<AuthPolicyValue>(AUTH_POLICY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'required';
    if (policy === 'optional' && request.headers.authorization === undefined) {
      return true;
    }
    request.principal = await this.accessPrincipalService.resolve(request.headers.authorization);
    return true;
  }
}
