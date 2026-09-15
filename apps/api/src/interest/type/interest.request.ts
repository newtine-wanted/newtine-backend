import { tags } from 'typia';

import type { CategoryCode } from '@newtine/core';

export interface LikedIssuesQuery {
  categoryCode?: CategoryCode;
  cursor?: string & tags.MinLength<1> & tags.MaxLength<512>;
  limit?: number & tags.Type<'uint32'> & tags.Minimum<1> & tags.Maximum<50>;
}
