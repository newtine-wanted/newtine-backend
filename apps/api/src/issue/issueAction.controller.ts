import { TypedBody, TypedException, TypedParam, TypedRoute } from '@nestia/core';
import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import typia, { tags } from 'typia';

import { AuthPolicy, CurrentUser } from '@newtine/api/auth/auth.decorator.js';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { DomainException, type AuthPrincipal } from '@newtine/core';
import { IssueActionService } from './issueAction.service.js';
import {
  toDetailViewProgressResponse,
  toDetailViewStartResponse,
  toIssueInteractionResponse,
} from './type/issueAction.mapper.js';
import type {
  DetailViewProgressRequest,
  DetailViewStartRequest,
  IssueInteractionRequest,
} from './type/issueAction.request.js';
import type {
  DetailViewProgressResponse,
  DetailViewStartResponse,
  IssueInteractionResponse,
} from './type/issueAction.response.js';

@Controller('issues')
@AuthPolicy('required')
@UseGuards(JwtAuthGuard)
export class IssueActionController {
  constructor(private readonly actionService: IssueActionService) {}

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.ServiceUnavailable)
  @HttpCode(200)
  @TypedRoute.Post(':issueId/interactions')
  async recordInteraction(
    @TypedParam('issueId', (value) => typia.assert<string & tags.Format<'uuid'>>(value))
    issueId: string & tags.Format<'uuid'>,
    @TypedBody<IssueInteractionRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<IssueInteractionRequest>(input),
    })
    request: IssueInteractionRequest,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<IssueInteractionResponse> {
    try {
      return toIssueInteractionResponse(
        await this.actionService.recordInteraction({
          issueId: issueId as AuthPrincipal['userId'],
          eventId: request.eventId as AuthPrincipal['userId'],
          sessionId: request.sessionId as AuthPrincipal['userId'],
          userId: principal.userId,
          action: request.action,
        }),
      );
    } catch (error) {
      throwActionError(error);
    }
  }

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.ServiceUnavailable)
  @HttpCode(HttpStatus.CREATED)
  @TypedRoute.Put(':issueId/detail-views/:viewId')
  async startDetailView(
    @TypedParam('issueId', (value) => typia.assert<string & tags.Format<'uuid'>>(value))
    issueId: string & tags.Format<'uuid'>,
    @TypedParam('viewId', (value) => typia.assert<string & tags.Format<'uuid'>>(value))
    viewId: string & tags.Format<'uuid'>,
    @TypedBody<DetailViewStartRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<DetailViewStartRequest>(input),
    })
    request: DetailViewStartRequest,
    @CurrentUser() principal: AuthPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DetailViewStartResponse> {
    try {
      const result = await this.actionService.startDetailView({
        issueId: issueId as AuthPrincipal['userId'],
        viewId: viewId as AuthPrincipal['userId'],
        sessionId: request.sessionId as AuthPrincipal['userId'],
        userId: principal.userId,
      });
      response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
      return toDetailViewStartResponse(result);
    } catch (error) {
      throwActionError(error);
    }
  }

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.Gone)
  @TypedException<ProblemDetails>(ApiException.ServiceUnavailable)
  @HttpCode(200)
  @TypedRoute.Put(':issueId/detail-views/:viewId/progress')
  async updateDetailView(
    @TypedParam('issueId', (value) => typia.assert<string & tags.Format<'uuid'>>(value))
    issueId: string & tags.Format<'uuid'>,
    @TypedParam('viewId', (value) => typia.assert<string & tags.Format<'uuid'>>(value))
    viewId: string & tags.Format<'uuid'>,
    @TypedBody<DetailViewProgressRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<DetailViewProgressRequest>(input),
    })
    request: DetailViewProgressRequest,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<DetailViewProgressResponse> {
    try {
      return toDetailViewProgressResponse(
        await this.actionService.updateDetailView({
          issueId: issueId as AuthPrincipal['userId'],
          viewId: viewId as AuthPrincipal['userId'],
          userId: principal.userId,
          activeMilliseconds: request.activeMilliseconds,
        }),
      );
    } catch (error) {
      throwActionError(error);
    }
  }
}

function throwActionError(error: unknown): never {
  if (error instanceof HttpException || error instanceof DomainException) throw error;
  throw new ServiceUnavailableException(undefined, { cause: error });
}
