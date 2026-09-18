import type { AgeGroupValue, OnboardingStateWithPreferences } from '@newtine/core';

export interface OnboardingStateResult {
  readonly status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  readonly completedAt: string | null;
  readonly ageGroup: AgeGroupValue | null;
  readonly regionCodes: readonly string[];
}

export function toStateResult(state: OnboardingStateWithPreferences): OnboardingStateResult {
  return {
    status: state.status,
    completedAt: state.completedAt?.toISOString() ?? null,
    ageGroup: state.ageGroup,
    regionCodes: state.regionCodes,
  };
}
