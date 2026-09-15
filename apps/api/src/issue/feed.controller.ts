import { TypedBody, TypedException, TypedParam, TypedRoute } from '@nestia/core';
import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import typia, { tags } from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import { AuthPolicy, CurrentUser } from '@newtine/api/auth/auth.decorator.js';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import type { AuthPrincipal } from '@newtine/core';
import { AUTH_OPTIONS, type AuthOptions } from '@newtine/api/auth/auth.options.js';
import { IssueFeedService } from './issueFeed.service.js';
import {
  createGuestFeedToken,
  hashGuestFeedToken,
  readGuestFeedToken,
  setGuestFeedCookie,
} from './guest-feed-cookie.js';
import { toFeedBatchResponse, toFeedSessionResponse } from './type/feed.mapper.js';
import type { FeedBatchRequest, FeedSessionCreateRequest } from './type/feed.request.js';
import type { FeedBatchResponse, FeedSessionResponse } from './type/feed.response.js';

@Controller('feed-sessions')
export class FeedController {
  constructor(
    private readonly issueFeedService: IssueFeedService,
    @Inject(AUTH_OPTIONS) private readonly authOptions: AuthOptions,
  ) {}

  /**
   * @security bearerAuth
   * @security
   */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @AuthPolicy('optional')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post()
  async create(
    @TypedBody<FeedSessionCreateRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<FeedSessionCreateRequest>(input),
    })
    _request: FeedSessionCreateRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser({ optional: true }) principal?: AuthPrincipal,
  ): Promise<FeedSessionResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    const owner =
      principal === undefined
        ? this.resolveGuestOwnerForCreate(request, response)
        : { kind: 'MEMBER' as const, userId: principal.userId };
    return toFeedSessionResponse(await this.issueFeedService.createSession(owner));
  }

  /**
   * @security bearerAuth
   * @security guestFeedCookie
   */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Gone)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @AuthPolicy('optional')
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
    @Req() httpRequest: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser({ optional: true }) principal?: AuthPrincipal,
  ): Promise<FeedBatchResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    const owner =
      principal === undefined
        ? this.resolveGuestOwnerForBatch(httpRequest)
        : { kind: 'MEMBER' as const, userId: principal.userId };
    return toFeedBatchResponse(
      await this.issueFeedService.getBatch({
        owner,
        sessionId,
        batchNo: request.batchNo,
      }),
    );
  }

  private resolveGuestOwnerForCreate(request: Request, response: Response) {
    const existingToken = readGuestFeedToken(request, this.authOptions.jwtSecret);
    const token = existingToken ?? createGuestFeedToken(this.authOptions.jwtSecret);
    setGuestFeedCookie(response, token, this.authOptions.cookieSecure);
    return { kind: 'GUEST' as const, guestTokenHash: hashGuestFeedToken(token) };
  }

  private resolveGuestOwnerForBatch(request: Request) {
    const token = readGuestFeedToken(request, this.authOptions.jwtSecret);
    if (token === undefined) {
      throw new UnauthorizedException('비회원 feed session cookie가 필요합니다.');
    }
    return { kind: 'GUEST' as const, guestTokenHash: hashGuestFeedToken(token) };
  }
}
