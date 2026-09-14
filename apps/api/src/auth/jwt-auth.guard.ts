import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import type { AuthenticatedRequest } from './auth.request.js';
import { AccessPrincipalService } from './application/access-principal.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly accessPrincipalService: AccessPrincipalService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.principal = await this.accessPrincipalService.resolve(request.headers.authorization);
    return true;
  }
}
