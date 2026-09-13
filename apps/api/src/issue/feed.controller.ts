import { TypedBody, TypedException, TypedParam, TypedRoute } from '@nestia/core';
import { BadRequestException, Controller, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import typia, { tags } from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { IssueFeedService } from './issueFeed.service.js';
import { toFeedBatchResponse, toFeedSessionResponse } from './type/feed.mapper.js';
import type { FeedBatchRequest, FeedSessionCreateRequest } from './type/feed.request.js';
import type { FeedBatchResponse, FeedSessionResponse } from './type/feed.response.js';

@Controller('feed-sessions')
export class FeedController {
  constructor(private readonly issueFeedService: IssueFeedService) {}

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post()
  async create(
    @TypedBody<FeedSessionCreateRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<FeedSessionCreateRequest>(input),
    })
    _request: FeedSessionCreateRequest,
    @Headers('x-user-id') userId?: string,
  ): Promise<FeedSessionResponse> {
    return toFeedSessionResponse(
      await this.issueFeedService.createSession({
        userId: parseUserId(userId),
        guestKey: null,
      }),
    );
  }

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Gone)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.InternalError)
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
    @Headers('x-user-id') userId?: string,
    @Headers('x-feed-guest-key') guestKey?: string,
  ): Promise<FeedBatchResponse> {
    return toFeedBatchResponse(
      await this.issueFeedService.getBatch({
        owner: toOwnerInput(userId, guestKey),
        sessionId,
        batchNo: request.batchNo,
      }),
    );
  }
}

function toOwnerInput(
  userId: string | undefined,
  guestKey: string | undefined,
): {
  userId: string | null;
  guestKey: string | null;
} {
  return { userId: parseUserId(userId), guestKey: parseGuestKey(guestKey) };
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

function parseGuestKey(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('요청 값이 올바르지 않습니다.');
  }
  if (value.trim() === '') return null;
  const normalized = value.trim();
  if (normalized.length > 256) {
    throw new BadRequestException('요청 값이 올바르지 않습니다.');
  }
  return normalized;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
