import type { Request, Response } from 'express';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DomainException, ErrorCode, exceptionDiagnostic } from '@newtine/core';

import { toApiException } from '@newtine/api/common/exception/domainException.mapper.js';
import { ApiException, httpStatusTitle } from '@newtine/api/common/exception/api.exception.js';
import type { HttpRequestContext } from '@newtine/api/common/middleware/httpRequestContext.middleware.js';
import type { ProblemDetails } from './type/problemDetails.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly pinoLogger: PinoLogger) {
    this.pinoLogger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & Partial<HttpRequestContext>>();
    const path = requestPath(request);
    const problem = this.toProblemDetails(exception);
    const requestId = request.requestId ?? 'unknown-request';
    const durationMs = elapsedMilliseconds(request.httpRequestStartedAt);
    request.httpExceptionLogged = true;
    const logContext = {
      event: 'http.exception',
      requestId,
      method: request.method,
      path,
      status: problem.status,
      apiCode: problem.code,
      exceptionName: exception instanceof Error ? exception.name : typeof exception,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(exception instanceof DomainException
        ? { domain: exception.domain, domainCode: exception.code }
        : { domain: exception instanceof HttpException ? 'http' : 'unknown' }),
    };

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.writeError({
        ...logContext,
        diagnostic: exceptionDiagnostic(exception),
      });
    } else {
      this.writeWarning(logContext);
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private writeWarning(fields: Record<string, unknown>): void {
    this.pinoLogger.warn(this.removeRequestBinding(fields), 'HTTP exception');
  }

  private writeError(fields: Record<string, unknown>): void {
    this.pinoLogger.error(this.removeRequestBinding(fields), 'HTTP exception');
  }

  private removeRequestBinding(fields: Record<string, unknown>): Record<string, unknown> {
    const bindings = this.pinoLogger.logger.bindings();
    if (bindings?.requestId !== fields.requestId) {
      return fields;
    }

    const fieldsWithoutRequestId = { ...fields };
    Reflect.deleteProperty(fieldsWithoutRequestId, 'requestId');
    return fieldsWithoutRequestId;
  }

  private toProblemDetails(exception: unknown): ProblemDetails {
    if (exception instanceof DomainException) {
      const apiException = toApiException(exception);
      const isInternal = apiException.status >= HttpStatus.INTERNAL_SERVER_ERROR;

      return {
        title: apiException.title,
        status: apiException.status,
        detail: isInternal ? '요청 처리 중 오류가 발생했습니다.' : exception.message,
        code: apiException.code,
      };
    }

    if (exception instanceof HttpException) {
      const status = normalizeHttpStatus(exception.getStatus());
      const payload = exception.getResponse();
      const isInternal = status >= HttpStatus.INTERNAL_SERVER_ERROR;
      const isValidationError = !isInternal && this.hasValidationErrors(payload);
      const code = this.toHttpErrorCode(status, isValidationError);

      return {
        title: httpStatusTitle(status),
        status,
        detail: isInternal
          ? '요청 처리 중 오류가 발생했습니다.'
          : isValidationError
            ? '요청 값이 올바르지 않습니다.'
            : this.toSafeDetail(payload, status, isValidationError),
        code,
      };
    }

    return {
      title: ApiException.InternalError.title,
      status: ApiException.InternalError.status,
      detail: '요청 처리 중 오류가 발생했습니다.',
      code: ApiException.InternalError.code,
    };
  }

  private toHttpErrorCode(status: number, isValidationError: boolean): string {
    if (isValidationError || status === HttpStatus.BAD_REQUEST) {
      return ErrorCode.InvalidArgument;
    }
    if (status === HttpStatus.NOT_FOUND) {
      return ErrorCode.NotFound;
    }
    if (status === HttpStatus.CONFLICT) {
      return ErrorCode.Conflict;
    }
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return ErrorCode.InternalError;
    }
    return `HTTP_${status}`;
  }

  private toSafeDetail(payload: unknown, status: number, isValidationError: boolean): string {
    if (isValidationError || status === HttpStatus.BAD_REQUEST) {
      if (hasSafeMessage(payload, '요청 JSON 형식이 올바르지 않습니다.')) {
        return '요청 JSON 형식이 올바르지 않습니다.';
      }
      return '요청 값이 올바르지 않습니다.';
    }

    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      return '요청 본문의 크기가 허용 한도를 초과했습니다.';
    }

    if (status === HttpStatus.NOT_FOUND) {
      return '요청한 리소스를 찾을 수 없습니다.';
    }

    return '요청을 처리할 수 없습니다.';
  }

  private hasValidationErrors(payload: unknown): boolean {
    if (!isRecord(payload)) {
      return false;
    }

    if (Array.isArray(payload.errors)) {
      return payload.errors.length > 0;
    }

    return Array.isArray(payload.message) && payload.message.length > 0;
  }
}

function hasSafeMessage(payload: unknown, expected: string): boolean {
  if (payload === expected) return true;
  return isRecord(payload) && payload.message === expected;
}

function normalizeHttpStatus(status: number): number {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requestPath(request: Request): string {
  if (typeof request.path === 'string' && request.path.length > 0) {
    return request.path;
  }

  const url = typeof request.url === 'string' ? request.url : '/';
  return url.split('?', 1)[0] || '/';
}

function elapsedMilliseconds(startedAt: bigint | undefined): number | undefined {
  if (startedAt === undefined) return undefined;
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
