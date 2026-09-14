import { DomainException } from '@newtine/core/common/exception/domain.exception.js';

export const OnboardingExceptionCode = {
  UserNotFound: 'ONBOARDING_USER_NOT_FOUND',
  InvalidSelection: 'ONBOARDING_INVALID_SELECTION',
} as const;

export type OnboardingExceptionCodeValue =
  (typeof OnboardingExceptionCode)[keyof typeof OnboardingExceptionCode];

export class OnboardingException extends DomainException<OnboardingExceptionCodeValue> {
  readonly domain = 'onboarding';

  constructor(code: OnboardingExceptionCodeValue, message: string, options?: ErrorOptions) {
    super(code, message, options);
  }
}
