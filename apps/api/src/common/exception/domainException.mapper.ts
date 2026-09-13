import { IssueExceptionCode } from '@newtine/core';
import type { DomainException } from '@newtine/core';
import { OnboardingExceptionCode } from '@newtine/core';

import {
  ApiException,
  type ApiExceptionSpec,
} from '@newtine/api/common/exception/api.exception.js';

const DOMAIN_EXCEPTION_API_MAPPINGS: Record<string, Record<string, ApiExceptionSpec>> = {
  issue: {
    [IssueExceptionCode.NotFound]: ApiException.NotFound,
    [IssueExceptionCode.FeedSessionNotFound]: ApiException.NotFound,
    [IssueExceptionCode.FeedSessionExpired]: ApiException.Gone,
    [IssueExceptionCode.FeedBatchConflict]: ApiException.Conflict,
    [IssueExceptionCode.FeedOwnerInvalid]: ApiException.InvalidArgument,
  },
  onboarding: {
    [OnboardingExceptionCode.UserNotFound]: ApiException.Unauthorized,
    [OnboardingExceptionCode.InvalidSelection]: ApiException.InvalidArgument,
  },
};

export function toApiException(exception: DomainException): ApiExceptionSpec {
  const mappings = DOMAIN_EXCEPTION_API_MAPPINGS[exception.domain];
  if (mappings === undefined || !Object.hasOwn(mappings, exception.code)) {
    return ApiException.InternalError;
  }

  return mappings[exception.code] as ApiExceptionSpec;
}
