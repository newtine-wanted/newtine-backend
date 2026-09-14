import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';

import { AUTH_REPOSITORY, type AuthRepository } from '@newtine/core';

import type { AuthenticatedRequest } from './auth.request.js';
import { JwtTokenService } from './jwt-token.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtTokenService: JwtTokenService,
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [^\s]+$/.test(authorization)) {
      throw new UnauthorizedException('인증이 필요합니다.');
    }

    let userId: string;
    try {
      userId = await this.jwtTokenService.verifyAccessToken(authorization.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException('인증이 필요합니다.');
    }

    const user = await this.authRepository.findUserById(userId);
    if (user === undefined) {
      throw new UnauthorizedException('인증이 필요합니다.');
    }

    request.authenticatedUserId = user.id;
    request.authenticatedUserRole = user.role;
    return true;
  }
}
