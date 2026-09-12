import { tags } from 'typia';

export interface IssueSearchRequest {
  query: string & tags.MinLength<1> & tags.MaxLength<100>;
  limit?: number & tags.Type<'uint32'> & tags.Maximum<50>;
}
