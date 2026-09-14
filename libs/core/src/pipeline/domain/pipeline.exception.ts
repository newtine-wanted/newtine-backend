import { DomainException } from '@newtine/core/common/exception/domain.exception.js';

export const PipelineExceptionCode = {
  InvalidInput: 'PIPELINE_INVALID_INPUT',
  RunNotFound: 'PIPELINE_RUN_NOT_FOUND',
  IdempotencyConflict: 'PIPELINE_IDEMPOTENCY_CONFLICT',
  ActiveRunConflict: 'PIPELINE_ACTIVE_RUN_CONFLICT',
  StaleAttempt: 'PIPELINE_STALE_ATTEMPT',
  RetryNotAllowed: 'PIPELINE_RETRY_NOT_ALLOWED',
  ClaimConflict: 'PIPELINE_CLAIM_CONFLICT',
  SourceUnavailable: 'PIPELINE_SOURCE_UNAVAILABLE',
  InsufficientEvidence: 'PIPELINE_INSUFFICIENT_EVIDENCE',
  UpstreamError: 'PIPELINE_UPSTREAM_ERROR',
  InvalidOutput: 'PIPELINE_INVALID_OUTPUT',
} as const;

export type PipelineExceptionCodeValue =
  (typeof PipelineExceptionCode)[keyof typeof PipelineExceptionCode];

export type PipelineExternalExceptionCode =
  | typeof PipelineExceptionCode.SourceUnavailable
  | typeof PipelineExceptionCode.InsufficientEvidence
  | typeof PipelineExceptionCode.UpstreamError
  | typeof PipelineExceptionCode.InvalidOutput;

export interface PipelineExceptionOptions extends ErrorOptions {
  /** Internal worker hint; never part of an API response or persisted failure code. */
  readonly retryable?: boolean;
  /** True only when the provider result is not known to have been accepted or rejected. */
  readonly resultUncertain?: boolean;
}

export class PipelineException extends DomainException<PipelineExceptionCodeValue> {
  readonly domain = 'pipeline';
  readonly retryable: boolean;
  readonly resultUncertain: boolean;

  constructor(
    code: PipelineExceptionCodeValue,
    message: string,
    options?: PipelineExceptionOptions,
  ) {
    super(code, message, options);
    this.retryable = options?.retryable ?? false;
    this.resultUncertain = options?.resultUncertain ?? false;
  }
}

const PIPELINE_EXTERNAL_MESSAGES: Record<PipelineExternalExceptionCode, string> = {
  [PipelineExceptionCode.SourceUnavailable]: '기사 원문을 확보할 수 없습니다.',
  [PipelineExceptionCode.InsufficientEvidence]: '독립 근거가 충분하지 않습니다.',
  [PipelineExceptionCode.UpstreamError]: '외부 공급자 처리 중 오류가 발생했습니다.',
  [PipelineExceptionCode.InvalidOutput]: '외부 처리 결과가 올바르지 않습니다.',
};

export function pipelineExternalException(
  code: PipelineExternalExceptionCode,
  options: Pick<PipelineExceptionOptions, 'cause' | 'retryable' | 'resultUncertain'> = {},
): PipelineException {
  return new PipelineException(code, PIPELINE_EXTERNAL_MESSAGES[code], options);
}
