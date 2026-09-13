import { TypedBody, TypedException, TypedQuery, TypedRoute } from '@nestia/core';
import { Controller, HttpCode, HttpStatus, Req } from '@nestjs/common';
import typia from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { requireAuthenticatedUserId, type AuthenticatedRequest } from './onboarding.auth.js';
import { OnboardingService } from './onboarding.service.js';
import { toEntitySearchCommand } from './type/onboarding.input.js';
import type {
  CompleteOnboardingRequest,
  OnboardingEntityQuery,
} from './type/onboarding.request.js';
import type {
  OnboardingEntitySearchResult,
  OnboardingOptionsResult,
  OnboardingStateResult,
} from './type/onboarding.output.js';
import { toEntitySearchResult, toOptionsResult, toStateResult } from './type/onboarding.output.js';

@Controller()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get('onboarding/options')
  async getOptions(): Promise<OnboardingOptionsResult> {
    return toOptionsResult(await this.onboardingService.getOptions());
  }

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get('onboarding/entities')
  async searchEntities(
    @TypedQuery<OnboardingEntityQuery>({
      type: 'validate',
      validate: (input) => typia.validateEquals<OnboardingEntityQuery>(input),
    })
    query: OnboardingEntityQuery,
  ): Promise<OnboardingEntitySearchResult> {
    return toEntitySearchResult(
      await this.onboardingService.searchEntities(
        toEntitySearchCommand({
          query: query.q,
          type: query.type,
          limit: query.limit,
          offset: query.offset,
        }),
      ),
    );
  }

  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get('me/onboarding')
  async getMyOnboarding(@Req() request: AuthenticatedRequest): Promise<OnboardingStateResult> {
    return toStateResult(
      await this.onboardingService.getMyOnboarding(requireAuthenticatedUserId(request)),
    );
  }

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post('me/onboarding/complete')
  async complete(
    @Req() request: AuthenticatedRequest,
    @TypedBody<CompleteOnboardingRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<CompleteOnboardingRequest>(input),
    })
    body: CompleteOnboardingRequest,
  ): Promise<OnboardingStateResult> {
    const state = await this.onboardingService.complete(requireAuthenticatedUserId(request), {
      topicCodes: body.topicCodes,
      entityIds: body.entityIds,
      ageGroup: body.ageGroup,
      regionCodes: body.regionCodes,
    });
    return toStateResult(state);
  }

  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post('me/onboarding/skip')
  async skip(@Req() request: AuthenticatedRequest): Promise<OnboardingStateResult> {
    return toStateResult(await this.onboardingService.skip(requireAuthenticatedUserId(request)));
  }
}
