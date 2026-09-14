import { Inject, Injectable } from '@nestjs/common';

import {
  AUTH_REPOSITORY,
  AuthRole,
  generateUuidV7,
  TRANSACTION_MANAGER,
  type AuthRepository,
  type TransactionManager,
} from '@newtine/core';

import { EmailAddress } from '../domain/email-address.js';
import { PasswordService } from '../password.service.js';
import { duplicateEmail, requireAuthSessionUser } from './auth.errors.js';
import type { AuthCredentialsInput, AuthSessionResult } from './auth.types.js';
import { SessionIssuer } from './session-issuer.js';

@Injectable()
export class SignupUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    private readonly passwordService: PasswordService,
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async execute(input: AuthCredentialsInput): Promise<AuthSessionResult> {
    const email = EmailAddress.create(input.email).value;
    const passwordHash = await this.passwordService.hash(input.password);
    const userId = generateUuidV7();
    const now = new Date();
    const refresh = this.sessionIssuer.createForUser(userId, now);
    const accessToken = await this.sessionIssuer.signAccessToken(userId);

    try {
      const user = await this.transactionManager.execute(async () => {
        const createdUser = await this.authRepository.createUser({
          id: userId,
          email,
          passwordHash,
          role: AuthRole.User,
          createdAt: now,
        });
        await this.authRepository.createRefreshSession(refresh.command);
        return createdUser;
      });
      return this.sessionIssuer.toResult(requireAuthSessionUser(user), accessToken, refresh.token);
    } catch (error) {
      throw duplicateEmail(error) ?? error;
    }
  }
}
