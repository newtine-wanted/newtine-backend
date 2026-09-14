import { TypedBody, TypedException, TypedParam, TypedRoute } from '@nestia/core';
import { Controller, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import typia, { tags } from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import { CurrentUser } from '@newtine/api/auth/auth.decorator.js';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import type { AuthPrincipal } from '@newtine/core';
import { IssueFeedService } from './issueFeed.service.js';
import { toFeedBatchResponse, toFeedSessionResponse } from './type/feed.mapper.js';
import type { FeedBatchRequest, FeedSessionCreateRequest } from './type/feed.request.js';
import type { FeedBatchResponse, FeedSessionResponse } from './type/feed.response.js';

@Controller('feed-sessions')
export class FeedController {
  constructor(private readonly issueFeedService: IssueFeedService) {}

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post()
  async create(
    @TypedBody<FeedSessionCreateRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<FeedSessionCreateRequest>(input),
    })
    _request: FeedSessionCreateRequest,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<FeedSessionResponse> {
    return toFeedSessionResponse(
      await this.issueFeedService.createSession({ userId: principal.userId }),
    );
  }

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Gone)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post(':sessionId/batches')
  async getBatch(
    @TypedParam('sessionId', (value) => typia.assert<string & tags.Format<'uuid'>>(value))
    sessionId: string & tags.Format<'uuid'>,
    @TypedBody<FeedBatchRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<FeedBatchRequest>(input),
    })
    request: FeedBatchRequest,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<FeedBatchResponse> {
    return toFeedBatchResponse(
      await this.issueFeedService.getBatch({
        owner: { userId: principal.userId },
        sessionId,
        batchNo: request.batchNo,
      }),
    );
  }
}
