import { TypedBody, TypedException, TypedRoute } from '@nestia/core';
import { Controller, HttpCode, HttpStatus } from '@nestjs/common';
import typia from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import { IssueSearchService } from './issueSearch.service.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { toIssueSearchInput, toIssueSearchResponse } from './type/issueSearch.mapper.js';
import type { IssueSearchRequest } from './type/issueSearch.request.js';
import type { IssueSearchResponse } from './type/issueSearch.response.js';

@Controller('issues')
export class IssueController {
  constructor(private readonly issueSearchService: IssueSearchService) {}

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
    const result = this.issueSearchService.search(toIssueSearchInput(request));

    return toIssueSearchResponse(result);
  }
}
