import { TypedBody, TypedException, TypedParam, TypedRoute } from '@nestia/core';
import { Controller, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import typia, { tags } from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import { AuthPolicy, CurrentUser } from '@newtine/api/auth/auth.decorator.js';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import type { AuthPrincipal } from '@newtine/core';
import { IssueDetailService } from './issueDetail.service.js';
import { IssueSearchService } from './issueSearch.service.js';
import { toIssueDetailResponse } from './type/issueDetail.mapper.js';
import type { IssueDetailResponse } from './type/issueDetail.response.js';
import { toIssueSearchInput, toIssueSearchResponse } from './type/issueSearch.mapper.js';
import type { IssueSearchRequest } from './type/issueSearch.request.js';
import type { IssueSearchResponse } from './type/issueSearch.response.js';

@Controller('issues')
export class IssueController {
  constructor(
    private readonly issueSearchService: IssueSearchService,
    private readonly issueDetailService: IssueDetailService,
  ) {}

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.PayloadTooLarge)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post('search')
  search(
    @TypedBody<IssueSearchRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<IssueSearchRequest>(input),
    })
    request: IssueSearchRequest,
  ): IssueSearchResponse {
    return toIssueSearchResponse(this.issueSearchService.search(toIssueSearchInput(request)));
  }

  /**
   * @security bearerAuth
   * @security
   */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @AuthPolicy('optional')
  @UseGuards(JwtAuthGuard)
  @TypedRoute.Get(':issueId')
  async getIssueDetail(
    @TypedParam('issueId', (value) => typia.assert<string & tags.Format<'uuid'>>(value))
    issueId: string & tags.Format<'uuid'>,
    @CurrentUser({ optional: true }) principal?: AuthPrincipal,
  ): Promise<IssueDetailResponse> {
    return toIssueDetailResponse(
      await this.issueDetailService.get(issueId, principal?.userId ?? null),
    );
  }
}
