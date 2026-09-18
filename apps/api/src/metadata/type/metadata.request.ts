import { tags } from 'typia';

import type { EntityTypeValue } from '@newtine/core';

export interface PoliticalActorQuery {
  q?: string & tags.MaxLength<100>;
  type?: EntityTypeValue;
  limit?: number & tags.Type<'uint32'> & tags.Minimum<1> & tags.Maximum<100>;
  offset?: number & tags.Type<'uint32'> & tags.Maximum<2147483647>;
}
