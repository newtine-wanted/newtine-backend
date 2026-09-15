import { tags } from 'typia';

export interface FeedRequest {
  cursor?: string & tags.MinLength<1> & tags.MaxLength<4096>;
}
