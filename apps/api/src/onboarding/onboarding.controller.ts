import { TypedBody, TypedException, TypedRoute } from '@nestia/core';
import { Controller, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import typia from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import { CurrentUser } from '@newtine/api/auth/auth.decorator.js';
import type { AuthPrincipal } from '@newtine/core';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { OnboardingService } from './onboarding.service.js';
import type { CompleteOnboardingRequest } from './type/onboarding.request.js';
import type { OnboardingStateResult } from './type/onboarding.output.js';
import { toStateResult } from './type/onboarding.output.js';

@Controller()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @UseGuards(JwtAuthGuard)
  @TypedRoute.Get('me/onboarding')
  async getMyOnboarding(@CurrentUser() principal: AuthPrincipal): Promise<OnboardingStateResult> {
    return toStateResult(await this.onboardingService.getMyOnboarding(principal.userId));
  }

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post('me/onboarding/complete')
  async complete(
    @CurrentUser() principal: AuthPrincipal,
    @TypedBody<CompleteOnboardingRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<CompleteOnboardingRequest>(input),
    })
    body: CompleteOnboardingRequest,
  ): Promise<OnboardingStateResult> {
    const state = await this.onboardingService.complete(principal.userId, {
      topicCodes: body.topicCodes,
      entityIds: body.entityIds,
      ageGroup: body.ageGroup,
      regionCodes: body.regionCodes,
    });
    return toStateResult(state);
  }

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post('me/onboarding/skip')
  async skip(@CurrentUser() principal: AuthPrincipal): Promise<OnboardingStateResult> {
    return toStateResult(await this.onboardingService.skip(principal.userId));
  }
}
