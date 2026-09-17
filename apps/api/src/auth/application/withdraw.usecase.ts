import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import {
  AUTH_REPOSITORY,
  type AuthRepository,
  type TransactionManager,
  TRANSACTION_MANAGER,
} from '@newtine/core';

import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import { invalidAuthenticatedUser } from './auth.errors.js';

@Injectable()
export class WithdrawUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(userId: UuidV7): Promise<void> {
    try {
      const deleted = await this.transactionManager.execute(() =>
        this.authRepository.deleteUser(userId),
      );
      if (!deleted) throw invalidAuthenticatedUser();
    } catch (error: unknown) {
      if (isTransientDatabaseError(error)) {
        throw new ServiceUnavailableException(undefined, { cause: error });
      }
      throw error;
    }
  }
}

function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current === null || typeof current !== 'object') return false;
    const code = (current as { readonly code?: unknown }).code;
    if (code === '40001' || code === '40P01' || code === '55P03' || code === '57014') {
      return true;
    }
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
}
