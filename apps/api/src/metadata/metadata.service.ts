import { Inject, Injectable } from '@nestjs/common';

import {
  ONBOARDING_REPOSITORY,
  type EntitySearchResult,
  type EntityTypeValue,
  type OnboardingOptions,
  type OnboardingRepository,
} from '@newtine/core';

@Injectable()
export class MetadataService {
  constructor(
    @Inject(ONBOARDING_REPOSITORY)
    private readonly onboardingRepository: OnboardingRepository,
  ) {}

  getCatalog(): OnboardingOptions | Promise<OnboardingOptions> {
    return this.onboardingRepository.getOptions();
  }

  searchPoliticalActors(input: {
    readonly query?: string;
    readonly type?: EntityTypeValue;
    readonly limit: number;
    readonly offset: number;
  }): EntitySearchResult | Promise<EntitySearchResult> {
    return this.onboardingRepository.searchEntities({
      query: input.query,
      type: input.type,
      limit: input.limit,
      offset: input.offset,
    });
  }
}
