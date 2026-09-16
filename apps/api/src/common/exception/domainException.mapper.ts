import { IssueExceptionCode, PipelineExceptionCode } from '@newtine/core';
import type { DomainException } from '@newtine/core';
import { OnboardingExceptionCode } from '@newtine/core';
import { AuthExceptionCode } from '@newtine/core';

import {
  ApiException,
  type ApiExceptionSpec,
} from '@newtine/api/common/exception/api.exception.js';

const DOMAIN_EXCEPTION_API_MAPPINGS: Record<string, Record<string, ApiExceptionSpec>> = {
  report: {
    INVALID_PERIOD: ApiException.InvalidArgument,
    NOT_FOUND: ApiException.NotFound,
    RETRY_NOT_ALLOWED: ApiException.Conflict,
    RATE_LIMITED: ApiException.RateLimited,
    INPUT_LIMIT_EXCEEDED: ApiException.ReportInputLimit,
    STALE_CLAIM: ApiException.Conflict,
    SOURCE_UNAVAILABLE: ApiException.Conflict,
  },
  issue: {
    [IssueExceptionCode.NotFound]: ApiException.NotFound,
    [IssueExceptionCode.FeedSessionNotFound]: ApiException.NotFound,
    [IssueExceptionCode.FeedSessionExpired]: ApiException.Gone,
    [IssueExceptionCode.FeedBatchConflict]: ApiException.Conflict,
  },
  pipeline: {
    [PipelineExceptionCode.InvalidInput]: ApiException.InvalidArgument,
    [PipelineExceptionCode.RunNotFound]: ApiException.NotFound,
    [PipelineExceptionCode.IdempotencyConflict]: ApiException.Conflict,
    [PipelineExceptionCode.ActiveRunConflict]: ApiException.Conflict,
    [PipelineExceptionCode.StaleAttempt]: ApiException.Conflict,
    [PipelineExceptionCode.RetryNotAllowed]: ApiException.Conflict,
    [PipelineExceptionCode.ClaimConflict]: ApiException.Conflict,
  },
  onboarding: {
    [OnboardingExceptionCode.UserNotFound]: ApiException.Unauthorized,
    [OnboardingExceptionCode.InvalidSelection]: ApiException.InvalidArgument,
  },
  auth: {
    [AuthExceptionCode.DuplicateEmail]: ApiException.Conflict,
    [AuthExceptionCode.InvalidEmail]: ApiException.InvalidArgument,
    [AuthExceptionCode.InvalidPassword]: ApiException.InvalidArgument,
    [AuthExceptionCode.InvalidCredentials]: ApiException.Unauthorized,
    [AuthExceptionCode.InvalidRefreshToken]: ApiException.Unauthorized,
  },
};

export function toApiException(exception: DomainException): ApiExceptionSpec {
  const mappings = DOMAIN_EXCEPTION_API_MAPPINGS[exception.domain];
  if (mappings === undefined || !Object.hasOwn(mappings, exception.code)) {
    return ApiException.InternalError;
  }

  return mappings[exception.code] as ApiExceptionSpec;
}
