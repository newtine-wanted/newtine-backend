import { tags } from 'typia';

import type { AgeGroupValue, EntityTypeValue } from '@newtine/core';

export interface OnboardingEntityQuery {
  q?: string & tags.MaxLength<100>;
  type?: EntityTypeValue;
  limit?: number & tags.Type<'uint32'> & tags.Minimum<1> & tags.Maximum<100>;
  offset?: number & tags.Type<'uint32'> & tags.Maximum<2147483647>;
}

export interface CompleteOnboardingRequest {
  topicCodes: string[] & tags.MinItems<1> & tags.MaxItems<12>;
  entityIds: (string & tags.Format<'uuid'>)[] & tags.MaxItems<100>;
  ageGroup: AgeGroupValue | null;
  regionCodes: string[] & tags.MaxItems<17>;
}
