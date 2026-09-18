import { TypedBody, TypedException, TypedParam, TypedRoute } from '@nestia/core';
import { Controller, Header, HttpCode, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import typia from 'typia';
import type { AuthPrincipal, UuidV7 } from '@newtine/core';
import { CurrentUser } from '@newtine/api/auth/auth.decorator.js';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { ReportService } from './report.service.js';
import type { ReportRequest, ReportUuid } from './type/report.request.js';
import type {
  ReportListResponse,
  ReportResponse,
  ReportSummaryResponse,
} from './type/report.response.js';

@Controller('me/reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly service: ReportService) {}
  /** @security bearerAuth */
  @Header('Cache-Control', 'private, no-store')
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get()
  list(@CurrentUser() principal: AuthPrincipal): Promise<ReportListResponse> {
    return this.service.list(principal.userId);
  }

  /** @security bearerAuth */
  @Header('Cache-Control', 'private, no-store')
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.ReportInputLimit)
  @TypedException<ProblemDetails>(ApiException.ServiceUnavailable)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(202)
  @TypedRoute.Post()
  async request(
    @CurrentUser() principal: AuthPrincipal,
    @TypedBody<ReportRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<ReportRequest>(input),
    })
    body: ReportRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReportSummaryResponse> {
    const result = await this.service.request(principal.userId, body.periodStart);
    const pending = result.status === 'QUEUED' || result.status === 'RUNNING';
    response
      .status(pending ? 202 : 200)
      .setHeader('Location', `/api/me/reports/${result.reportId}`);
    return result;
  }

  /** @security bearerAuth */
  @Header('Cache-Control', 'private, no-store')
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get(':reportId')
  get(
    @CurrentUser() principal: AuthPrincipal,
    @TypedParam('reportId') reportId: ReportUuid,
  ): Promise<ReportResponse> {
    return this.service.get(principal.userId, reportId as UuidV7);
  }

  /** @security bearerAuth */
  @Header('Cache-Control', 'private, no-store')
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.RateLimited)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(202)
  @TypedRoute.Post(':reportId/retry')
  retry(
    @CurrentUser() principal: AuthPrincipal,
    @TypedParam('reportId') reportId: ReportUuid,
  ): Promise<ReportSummaryResponse> {
    return this.service.retry(principal.userId, reportId as UuidV7);
  }
}
