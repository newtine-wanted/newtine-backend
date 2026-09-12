export const ErrorCode = {
  InvalidArgument: 'INVALID_ARGUMENT',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
