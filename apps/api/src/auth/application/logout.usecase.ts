import { Inject, Injectable } from '@nestjs/common';

import {
  AUTH_REPOSITORY,
  TRANSACTION_MANAGER,
  type AuthRepository,
  type TransactionManager,
} from '@newtine/core';

import { hashRefreshToken, isRefreshToken } from '../security/refresh-token.js';

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(refreshToken: string | undefined): Promise<void> {
    if (!isRefreshToken(refreshToken)) {
      return;
    }

    await this.transactionManager.execute(() =>
      this.authRepository.revokeRefreshSession(hashRefreshToken(refreshToken), new Date()),
    );
  }
}
