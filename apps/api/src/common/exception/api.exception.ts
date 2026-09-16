import { HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

import { ErrorCode } from '@newtine/core';

export const ApiException = {
  InvalidArgument: {
    code: ErrorCode.InvalidArgument,
    status: HttpStatus.BAD_REQUEST,
    title: 'Bad Request',
    description: 'The request is invalid.',
  },
  Unauthorized: {
    code: ErrorCode.Unauthorized,
    status: HttpStatus.UNAUTHORIZED,
    title: 'Unauthorized',
    description: 'Authentication is required.',
  },
  Forbidden: {
    code: ErrorCode.Forbidden,
    status: HttpStatus.FORBIDDEN,
    title: 'Forbidden',
    description: 'The authenticated principal is not allowed to perform this action.',
  },
  NotFound: {
    code: ErrorCode.NotFound,
    status: HttpStatus.NOT_FOUND,
    title: 'Not Found',
    description: 'The requested resource was not found.',
  },
  Conflict: {
    code: ErrorCode.Conflict,
    status: HttpStatus.CONFLICT,
    title: 'Conflict',
    description: 'The request conflicts with the current resource state.',
  },
  ServiceUnavailable: {
    code: ErrorCode.ServiceUnavailable,
    status: HttpStatus.SERVICE_UNAVAILABLE,
    title: 'Service Unavailable',
    description: 'The service is temporarily unavailable.',
  },
  Gone: {
    code: 'GONE',
    status: HttpStatus.GONE,
    title: 'Gone',
    description: 'The requested resource is no longer available.',
  },
  PayloadTooLarge: {
    code: 'HTTP_413',
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    title: 'Payload Too Large',
    description: 'The request body exceeds the size limit.',
  },
  RateLimited: {
    code: 'RATE_LIMITED',
    status: HttpStatus.TOO_MANY_REQUESTS,
    title: 'Too Many Requests',
    description: 'Retry cooldown is active.',
  },
  ReportInputLimit: {
    code: 'INPUT_LIMIT_EXCEEDED',
    status: HttpStatus.BAD_REQUEST,
    title: 'Bad Request',
    description: 'Report input exceeds the configured limit.',
  },
  InternalError: {
    code: ErrorCode.InternalError,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    title: 'Internal Server Error',
    description: 'The server could not complete the request.',
  },
} as const;

export type ApiExceptionSpec = (typeof ApiException)[keyof typeof ApiException];

export function httpStatusTitle(status: number): string {
  return STATUS_CODES[status] ?? 'HTTP Error';
}
