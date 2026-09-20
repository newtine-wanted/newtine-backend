import { DomainException } from '@newtine/core/common/exception/domain.exception.js';

export const OnboardingExceptionCode = {
  UserNotFound: 'ONBOARDING_USER_NOT_FOUND',
  InvalidSelection: 'ONBOARDING_INVALID_SELECTION',
  SelectionDerivationAnomaly: 'ONBOARDING_SELECTION_DERIVATION_ANOMALY',
} as const;

export type OnboardingExceptionCodeValue =
  (typeof OnboardingExceptionCode)[keyof typeof OnboardingExceptionCode];

export interface OnboardingSelectionDerivationAnomaly {
  readonly categoryCode: string;
  readonly aggregateWeight: number;
  readonly actionWeight: number;
  readonly residual: number;
}

export interface OnboardingExceptionDiagnostic {
  readonly kind: 'selection_derivation_anomaly';
  readonly userId: string;
  readonly anomalies: readonly OnboardingSelectionDerivationAnomaly[];
}

export class OnboardingException extends DomainException<OnboardingExceptionCodeValue> {
  readonly domain = 'onboarding';
  readonly diagnostic?: OnboardingExceptionDiagnostic;

  constructor(
    code: OnboardingExceptionCodeValue,
    message: string,
    options?: ErrorOptions,
    diagnostic?: OnboardingExceptionDiagnostic,
  ) {
    super(code, message, options);
    this.diagnostic = diagnostic;
  }
}
