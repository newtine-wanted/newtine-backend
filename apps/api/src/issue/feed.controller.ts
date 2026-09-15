import { TypedException, TypedQuery, TypedRoute } from '@nestia/core';
import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import typia from 'typia';

import { AuthPolicy, CurrentUser } from '@newtine/api/auth/auth.decorator.js';
import { AUTH_OPTIONS, type AuthOptions } from '@newtine/api/auth/auth.options.js';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import {
  DomainException,
  IssueException,
  IssueExceptionCode,
  type AuthPrincipal,
  type FeedOwner,
} from '@newtine/core';
import {
  createFeedCursor,
  feedCursorOwnerMatches,
  FeedCursorError,
  readFeedCursor,
} from './feed-cursor.js';
import {
  createGuestFeedToken,
  feedGuestOwner,
  hashGuestFeedToken,
  readGuestFeedCredential,
  setGuestFeedCookie,
} from './guest-feed-cookie.js';
import { IssueFeedService } from './issueFeed.service.js';
import { toFeedResponse } from './type/feed.mapper.js';
import type { FeedRequest } from './type/feed.request.js';
import type { FeedResponse } from './type/feed.response.js';

@Controller('feed')
export class FeedController {
  constructor(
    private readonly issueFeedService: IssueFeedService,
    @Inject(AUTH_OPTIONS) private readonly authOptions: AuthOptions,
  ) {}

  /**
   * @security bearerAuth
   * @security guestFeedCookie
   * @security
   */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Gone)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.ServiceUnavailable)
  @AuthPolicy('optional')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Get()
  async getFeed(
    @TypedQuery<FeedRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<FeedRequest>(input),
    })
    request: FeedRequest,
    @Req() httpRequest: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser({ optional: true }) principal?: AuthPrincipal,
  ): Promise<FeedResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      const normalizedRequest = this.normalizeRequest(request, httpRequest);
      const claims =
        normalizedRequest.cursor === undefined
          ? undefined
          : this.readCursor(normalizedRequest.cursor);
      const owner = this.resolveOwner(httpRequest, response, principal, claims !== undefined);
      if (claims !== undefined && !feedCursorOwnerMatches(claims, owner)) {
        throw new NotFoundException('탐색 커서를 찾을 수 없습니다.');
      }
      const page = await this.issueFeedService.getFeed(
        owner,
        claims === undefined
          ? undefined
          : { sessionId: claims.sessionId, batchNo: claims.nextBatchNo },
      );
      const nextCursor =
        page.continuation === 'CONTINUE'
          ? createFeedCursor(this.authOptions.jwtSecret, {
              sessionId: page.sessionId,
              nextBatchNo: page.nextBatchNo ?? page.batchNo + 1,
              owner,
              expiresAt: page.expiresAt,
            })
          : null;
      return toFeedResponse(page, nextCursor);
    } catch (error) {
      if (error instanceof HttpException || error instanceof DomainException) throw error;
      throw new ServiceUnavailableException(undefined, { cause: error });
    }
  }

  private normalizeRequest(request: FeedRequest, httpRequest: Request): FeedRequest {
    const query = httpRequest.query as Record<string, unknown>;
    if (Object.keys(query).some((key) => key !== 'cursor')) {
      throw new BadRequestException('feed query가 올바르지 않습니다.');
    }

    const rawCursor = query.cursor;
    if (rawCursor === undefined) return request;
    if (typeof rawCursor !== 'string' || rawCursor.length < 1 || rawCursor.length > 4096) {
      throw new BadRequestException('탐색 커서가 올바르지 않습니다.');
    }
    return { cursor: rawCursor };
  }

  private readCursor(token: string) {
    try {
      return readFeedCursor(token, this.authOptions.jwtSecret);
    } catch (error) {
      if (error instanceof FeedCursorError && error.kind === 'EXPIRED') {
        throw new IssueException(
          IssueExceptionCode.FeedSessionExpired,
          '탐색 커서가 만료되었습니다.',
        );
      }
      throw new BadRequestException('탐색 커서가 올바르지 않습니다.');
    }
  }

  private resolveOwner(
    request: Request,
    response: Response,
    principal: AuthPrincipal | undefined,
    cursorRequest: boolean,
  ): FeedOwner {
    if (principal !== undefined) {
      return { kind: 'MEMBER', userId: principal.userId.toLowerCase() };
    }

    const credential = readGuestFeedCredential(request, this.authOptions.jwtSecret);
    if (credential !== undefined) {
      if (!cursorRequest && credential.legacy) {
        const token = createGuestFeedToken(this.authOptions.jwtSecret);
        setGuestFeedCookie(response, token, this.authOptions.cookieSecure);
        return feedGuestOwner(hashGuestFeedToken(token));
      }
      return feedGuestOwner(hashGuestFeedToken(credential.token));
    }
    if (cursorRequest) {
      throw new UnauthorizedException('탐색 커서와 일치하는 guest feed cookie가 필요합니다.');
    }

    const token = createGuestFeedToken(this.authOptions.jwtSecret);
    setGuestFeedCookie(response, token, this.authOptions.cookieSecure);
    return feedGuestOwner(hashGuestFeedToken(token));
  }
}
