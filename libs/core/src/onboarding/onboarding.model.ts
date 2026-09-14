import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import type { CategoryCode } from '@newtine/core/common/category/category.catalog.js';

export const OnboardingStatus = {
  Pending: 'PENDING',
  Completed: 'COMPLETED',
  Skipped: 'SKIPPED',
} as const;

export type OnboardingStatusValue = (typeof OnboardingStatus)[keyof typeof OnboardingStatus];

export const AgeGroup = {
  Age19To34: 'AGE_19_34',
  Age35To49: 'AGE_35_49',
  Age50To64: 'AGE_50_64',
  Age65Plus: 'AGE_65_PLUS',
} as const;

export type AgeGroupValue = (typeof AgeGroup)[keyof typeof AgeGroup];

export interface OnboardingTopicOption {
  readonly code: CategoryCode;
  readonly name: string;
  readonly displayOrder: number;
}

export interface OnboardingAgeOption {
  readonly code: AgeGroupValue;
  readonly name: string;
  readonly displayOrder: number;
}

export const EntityType = {
  Politician: 'POLITICIAN',
  Party: 'PARTY',
  Institution: 'INSTITUTION',
} as const;

export type EntityTypeValue = (typeof EntityType)[keyof typeof EntityType];

export interface RegionOption {
  readonly code: string;
  readonly name: string;
  readonly displayOrder: number;
}

export interface OnboardingEntity {
  readonly id: UuidV7;
  readonly name: string;
  readonly type: EntityTypeValue;
  readonly subtitle?: string;
  readonly aliases: readonly string[];
  readonly isActive: boolean;
}

export interface OnboardingOptions {
  readonly topics: readonly OnboardingTopicOption[];
  readonly ageGroups: readonly OnboardingAgeOption[];
  readonly regions: readonly RegionOption[];
}

export interface OnboardingState {
  readonly userId: UuidV7;
  readonly status: OnboardingStatusValue;
  readonly completedAt: Date | null;
  readonly ageGroup: AgeGroupValue | null;
  readonly regionCodes: readonly string[];
}

export interface OnboardingPreferenceSnapshot {
  readonly topicWeights: Readonly<Record<string, number>>;
  readonly entityWeights: Readonly<Record<string, number>>;
  readonly regionWeights: Readonly<Record<string, number>>;
}

export interface OnboardingStateWithPreferences extends OnboardingState {
  readonly preferences: OnboardingPreferenceSnapshot;
}

export interface CompleteOnboardingCommand {
  readonly topicCodes: readonly CategoryCode[];
  readonly entityIds: readonly string[];
  readonly ageGroup: AgeGroupValue | null;
  readonly regionCodes: readonly string[];
}

export interface EntitySearchCommand {
  readonly query?: string;
  readonly type?: EntityTypeValue;
  readonly limit: number;
  readonly offset: number;
}

export interface EntitySearchResult {
  readonly items: readonly OnboardingEntity[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export type MaybePromise<T> = T | Promise<T>;

export interface OnboardingRepository {
  getOptions(): MaybePromise<OnboardingOptions>;
  searchEntities(command: EntitySearchCommand): MaybePromise<EntitySearchResult>;
  findOnboarding(userId: string): MaybePromise<OnboardingStateWithPreferences | undefined>;
  completeOnboarding(
    userId: string,
    command: CompleteOnboardingCommand,
  ): MaybePromise<OnboardingStateWithPreferences>;
  skipOnboarding(userId: string): MaybePromise<OnboardingStateWithPreferences>;
}

export const ONBOARDING_REPOSITORY = Symbol('ONBOARDING_REPOSITORY');
