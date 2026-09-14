import { Inject, Injectable } from '@nestjs/common';

import {
  AUTH_REPOSITORY,
  TRANSACTION_MANAGER,
  toAuthAccount,
  type AuthRepository,
  type TransactionManager,
} from '@newtine/core';

import { EmailAddress } from '../domain/email-address.js';
import { assertPasswordLength, PasswordService } from '../password.service.js';
import { invalidCredentials } from './auth.errors.js';
import type { AuthCredentialsInput, AuthSessionResult } from './auth.types.js';
import { SessionIssuer } from './session-issuer.js';

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    private readonly passwordService: PasswordService,
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async execute(input: AuthCredentialsInput): Promise<AuthSessionResult> {
    const email = EmailAddress.create(input.email).value;
    assertPasswordLength(input.password);
    const user = await this.authRepository.findUserByEmail(email);
    const account = user === undefined ? undefined : toAuthAccount(user);
    if (
      account === undefined ||
      !(await this.passwordService.verify(input.password, account.passwordHash))
    ) {
      throw invalidCredentials();
    }

    const now = new Date();
    const refresh = this.sessionIssuer.createForUser(account.id, now);
    const accessToken = await this.sessionIssuer.signAccessToken(account.id);
    await this.transactionManager.execute(() =>
      this.authRepository.createRefreshSession(refresh.command),
    );

    return this.sessionIssuer.toResult(account, accessToken, refresh.token);
  }
}
