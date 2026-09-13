export const ErrorCode = {
  InvalidArgument: 'INVALID_ARGUMENT',
  Unauthorized: 'UNAUTHORIZED',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
