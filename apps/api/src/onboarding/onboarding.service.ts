import { Inject, Injectable } from '@nestjs/common';

import {
  ONBOARDING_REPOSITORY,
  TRANSACTION_MANAGER,
  type OnboardingRepository,
  type TransactionManager,
} from '@newtine/core';
import { OnboardingException, OnboardingExceptionCode } from '@newtine/core';
import type {
  CompleteOnboardingInput,
  EntitySearchInput,
} from '@newtine/api/onboarding/type/onboarding.input.js';

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(ONBOARDING_REPOSITORY)
    private readonly onboardingRepository: OnboardingRepository,
    @Inject(TRANSACTION_MANAGER)
    private readonly transactionManager: TransactionManager,
  ) {}

  async getOptions() {
    return this.onboardingRepository.getOptions();
  }

  async searchEntities(input: EntitySearchInput) {
    return this.onboardingRepository.searchEntities({
      query: input.query,
      type: input.type,
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
    });
  }

  async getMyOnboarding(userId: string) {
    const state = await this.onboardingRepository.findOnboarding(userId);
    if (state === undefined) {
      throw new OnboardingException(
        OnboardingExceptionCode.UserNotFound,
        '인증된 사용자를 찾을 수 없습니다.',
      );
    }
    return state;
  }

  complete(userId: string, input: CompleteOnboardingInput) {
    return this.transactionManager.execute(async () =>
      this.onboardingRepository.completeOnboarding(userId, {
        topicCodes: input.topicCodes,
        entityIds: input.entityIds,
        ageGroup: input.ageGroup,
        regionCodes: input.regionCodes,
      }),
    );
  }

  skip(userId: string) {
    return this.transactionManager.execute(async () =>
      this.onboardingRepository.skipOnboarding(userId),
    );
  }
}
