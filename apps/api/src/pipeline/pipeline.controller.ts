import { TypedBody, TypedException, TypedHeaders, TypedParam, TypedRoute } from '@nestia/core';
import { Controller, HttpCode, HttpStatus } from '@nestjs/common';
import typia from 'typia';

import { PipelineRunService } from '@newtine/core';
import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { toPipelineRunAcceptedResponse, toPipelineRunResponse } from './type/pipelineRun.mapper.js';
import type {
  PipelineRunCreateRequest,
  PipelineRunInterruptRequest,
  PipelineRunRetryRequest,
} from './type/pipelineRun.input.js';
import type {
  PipelineRunAcceptedResponse,
  PipelineRunResponse,
} from './type/pipelineRun.response.js';

@Controller('pipeline/runs')
export class PipelineController {
  constructor(private readonly pipelineRunService: PipelineRunService) {}

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.ACCEPTED)
  @TypedRoute.Post()
  async create(
    @TypedHeaders<{ 'idempotency-key': string }>({
      type: 'validate',
      validate: (input) =>
        typia.validate<{ 'idempotency-key': string }>({
          'idempotency-key': (input as Record<string, unknown>)['idempotency-key'],
        }),
    })
    headers: { 'idempotency-key': string },
    @TypedBody<PipelineRunCreateRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<PipelineRunCreateRequest>(input),
    })
    request: PipelineRunCreateRequest,
  ): Promise<PipelineRunAcceptedResponse> {
    const snapshot = await this.pipelineRunService.enqueue({
      idempotencyKey: headers['idempotency-key'],
      query: request.query,
    });
    return toPipelineRunAcceptedResponse(snapshot);
  }

  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get(':runId')
  async get(@TypedParam('runId') runId: string): Promise<PipelineRunResponse> {
    return toPipelineRunResponse(await this.pipelineRunService.get(runId));
  }

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.ACCEPTED)
  @TypedRoute.Post(':runId/retry')
  async retry(
    @TypedParam('runId') runId: string,
    @TypedBody<PipelineRunRetryRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<PipelineRunRetryRequest>(input),
    })
    request: PipelineRunRetryRequest,
  ): Promise<PipelineRunAcceptedResponse> {
    const snapshot = await this.pipelineRunService.retry({
      runId,
      ...request,
    });
    return toPipelineRunAcceptedResponse(snapshot);
  }

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.NotFound)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.ACCEPTED)
  @TypedRoute.Post(':runId/interrupt')
  async interrupt(
    @TypedParam('runId') runId: string,
    @TypedBody<PipelineRunInterruptRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<PipelineRunInterruptRequest>(input),
    })
    request: PipelineRunInterruptRequest,
  ): Promise<PipelineRunAcceptedResponse> {
    const snapshot = await this.pipelineRunService.interrupt({
      runId,
      expectedAttempt: request.expectedAttempt,
      executionId: request.executionId,
    });
    return toPipelineRunAcceptedResponse(snapshot);
  }
}
