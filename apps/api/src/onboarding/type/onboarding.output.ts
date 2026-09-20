import type { AgeGroupValue, CategoryCode, OnboardingStateWithPreferences } from '@newtine/core';

export interface OnboardingStateResult {
  readonly status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  readonly completedAt: string | null;
  readonly topicCodes: readonly CategoryCode[];
  readonly entityIds: readonly string[];
  readonly ageGroup: AgeGroupValue | null;
  readonly regionCodes: readonly string[];
}

export function toStateResult(state: OnboardingStateWithPreferences): OnboardingStateResult {
  return {
    status: state.status,
    completedAt: state.completedAt?.toISOString() ?? null,
    topicCodes: state.topicCodes,
    entityIds: state.entityIds,
    ageGroup: state.ageGroup,
    regionCodes: state.regionCodes,
  };
}
