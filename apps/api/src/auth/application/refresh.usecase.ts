import { Inject, Injectable } from '@nestjs/common';

import {
  AUTH_REPOSITORY,
  TRANSACTION_MANAGER,
  type AuthRepository,
  type TransactionManager,
} from '@newtine/core';

import { invalidRefreshToken, requireAuthSessionUser } from './auth.errors.js';
import type { AuthSessionResult } from './auth.types.js';
import { SessionIssuer } from './session-issuer.js';
import { hashRefreshToken, isRefreshToken } from '../security/refresh-token.js';

@Injectable()
export class RefreshUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async execute(refreshToken: string | undefined): Promise<AuthSessionResult> {
    if (!isRefreshToken(refreshToken)) {
      throw invalidRefreshToken();
    }

    const now = new Date();
    const replacement = this.sessionIssuer.createReplacement(now);
    const result = await this.transactionManager.execute(async () => {
      const rotation = await this.authRepository.rotateRefreshSession({
        tokenHash: hashRefreshToken(refreshToken),
        replacement: replacement.command,
        now,
      });
      if (rotation.status !== 'rotated') {
        return rotation;
      }

      const user = requireAuthSessionUser(rotation.user);
      const accessToken = await this.sessionIssuer.signAccessToken(user.id);
      return {
        status: 'rotated' as const,
        session: this.sessionIssuer.toResult(user, accessToken, replacement.token),
      };
    });

    if (result.status !== 'rotated') {
      throw invalidRefreshToken();
    }
    return result.session;
  }
}
