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
  PayloadTooLarge: {
    code: 'HTTP_413',
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    title: 'Payload Too Large',
    description: 'The request body exceeds the size limit.',
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
