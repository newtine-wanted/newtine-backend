import type {
  AgeGroupValue,
  EntitySearchResult,
  EntityTypeValue,
  OnboardingOptions,
  OnboardingStateWithPreferences,
} from '@newtine/core';

export type OnboardingOptionsResult = OnboardingOptions;

export interface OnboardingEntityResult {
  readonly id: string;
  readonly name: string;
  readonly type: EntityTypeValue;
  readonly subtitle?: string;
  readonly aliases: readonly string[];
}

export interface OnboardingEntitySearchResult {
  readonly items: readonly OnboardingEntityResult[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface OnboardingStateResult {
  readonly status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  readonly completedAt: string | null;
  readonly ageGroup: AgeGroupValue | null;
  readonly regionCodes: readonly string[];
}

export function toOptionsResult(options: OnboardingOptions): OnboardingOptionsResult {
  return options;
}

export function toEntitySearchResult(result: EntitySearchResult): OnboardingEntitySearchResult {
  return {
    items: result.items.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      ...(entity.subtitle === undefined ? {} : { subtitle: entity.subtitle }),
      aliases: entity.aliases,
    })),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  };
}

export function toStateResult(state: OnboardingStateWithPreferences): OnboardingStateResult {
  return {
    status: state.status,
    completedAt: state.completedAt?.toISOString() ?? null,
    ageGroup: state.ageGroup,
    regionCodes: state.regionCodes,
  };
}
