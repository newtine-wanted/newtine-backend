import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import {
  AUTH_REPOSITORY,
  toAuthPrincipal,
  type AuthPrincipal,
  type AuthRepository,
} from '@newtine/core';

import { JwtTokenService } from '../jwt-token.service.js';

/** Resolves an access header into a DB-backed principal for the HTTP guard. */
@Injectable()
export class AccessPrincipalService {
  constructor(
    private readonly jwtTokenService: JwtTokenService,
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
  ) {}

  async resolve(authorization: string | undefined): Promise<AuthPrincipal> {
    if (typeof authorization !== 'string' || !/^Bearer [^\s]+$/.test(authorization)) {
      throw this.unauthorized();
    }

    let userId: AuthPrincipal['userId'];
    try {
      userId = await this.jwtTokenService.verifyAccessToken(authorization.slice('Bearer '.length));
    } catch {
      throw this.unauthorized();
    }

    const user = await this.authRepository.findUserById(userId);
    if (user === undefined) {
      throw this.unauthorized();
    }
    return toAuthPrincipal(user);
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException('인증이 필요합니다.');
  }
}
