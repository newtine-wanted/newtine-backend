import type { AgeGroupValue, EntitySearchCommand, EntityTypeValue } from '@newtine/core';

export interface CompleteOnboardingInput {
  readonly topicCodes: readonly string[];
  readonly entityIds: readonly string[];
  readonly ageGroup: AgeGroupValue | null;
  readonly regionCodes: readonly string[];
}

export interface EntitySearchInput {
  readonly query?: string;
  readonly type?: EntityTypeValue;
  readonly limit?: number;
  readonly offset?: number;
}

export function toEntitySearchCommand(input: EntitySearchInput): EntitySearchCommand {
  return {
    query: input.query,
    type: input.type,
    limit: input.limit ?? 20,
    offset: input.offset ?? 0,
  };
}
