import { Inject, Injectable } from '@nestjs/common';

import { type AuthSessionUser, type UuidV7 } from '@newtine/core';

import { AUTH_OPTIONS, type AuthOptions } from '../auth.options.js';
import { JwtTokenService } from '../jwt-token.service.js';
import {
  createRefreshSession,
  createRefreshSessionReplacement,
  type RefreshSessionDraft,
  type RefreshSessionReplacementDraft,
} from '../security/refresh-token.js';
import { toAuthSessionResult } from './auth-session.result.js';
import type { AuthSessionResult } from './auth.types.js';

/** Coordinates token issuance without owning a signup/login/refresh workflow. */
@Injectable()
export class SessionIssuer {
  constructor(
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  createForUser(userId: UuidV7, now: Date): RefreshSessionDraft {
    return createRefreshSession(userId, now, this.options);
  }

  createReplacement(now: Date): RefreshSessionReplacementDraft {
    return createRefreshSessionReplacement(now, this.options);
  }

  signAccessToken(userId: UuidV7): Promise<string> {
    return this.jwtTokenService.signAccessToken(userId);
  }

  toResult(user: AuthSessionUser, accessToken: string, refreshToken: string): AuthSessionResult {
    return toAuthSessionResult(user, accessToken, refreshToken, this.options.accessTokenTtlSeconds);
  }
}
