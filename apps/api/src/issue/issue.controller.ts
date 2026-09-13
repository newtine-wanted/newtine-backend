import { TypedBody, TypedException, TypedParam, TypedRoute } from '@nestia/core';
import { BadRequestException, Controller, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import typia, { tags } from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
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

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get(':issueId')
  async getIssueDetail(
    @TypedParam('issueId', (value) => typia.assert<string & tags.Format<'uuid'>>(value))
    issueId: string & tags.Format<'uuid'>,
    @Headers('x-user-id') userId?: string,
  ): Promise<IssueDetailResponse> {
    return toIssueDetailResponse(await this.issueDetailService.get(issueId, parseUserId(userId)));
  }
}

function parseUserId(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('요청 값이 올바르지 않습니다.');
  }
  if (value.trim() === '') return null;
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new BadRequestException('요청 값이 올바르지 않습니다.');
  }
  return normalized.toLowerCase();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
