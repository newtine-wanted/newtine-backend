import { TypedException, TypedQuery, TypedRoute } from '@nestia/core';
import { Controller, Header, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import typia from 'typia';

import type { AuthPrincipal } from '@newtine/core';
import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import { CurrentUser } from '@newtine/api/auth/auth.decorator.js';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { InterestService } from './interest.service.js';
import type { LikedIssuesQuery } from './type/interest.request.js';
import {
  toInterestAnalysisResponse,
  toLikedIssuesResponse,
  type InterestAnalysisResponse,
  type LikedIssuesResponse,
} from './type/interest.output.js';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class InterestController {
  constructor(private readonly interestService: InterestService) {}

  /** @security bearerAuth */
  @Header('Cache-Control', 'private, no-store')
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Get('interest-analysis')
  async getAnalysis(@CurrentUser() principal: AuthPrincipal): Promise<InterestAnalysisResponse> {
    return toInterestAnalysisResponse(
      await this.interestService.getInterestAnalysis(principal.userId),
    );
  }

  /** @security bearerAuth */
  @Header('Cache-Control', 'private, no-store')
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Get('liked-issues')
  async getLikedIssues(
    @CurrentUser() principal: AuthPrincipal,
    @TypedQuery<LikedIssuesQuery>({
      type: 'validate',
      validate: (input) => typia.http.validateQuery<LikedIssuesQuery>(input),
    })
    query: LikedIssuesQuery,
  ): Promise<LikedIssuesResponse> {
    const result = await this.interestService.getLikedIssues(principal.userId, query);
    return toLikedIssuesResponse(result, this.interestService.encodeCursor);
  }
}
