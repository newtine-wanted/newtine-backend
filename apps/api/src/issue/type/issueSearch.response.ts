import { tags } from 'typia';

export interface IssueSearchItem {
  id: string & tags.Format<'uuid'>;
  title: string;
  publicationStatus: 'PUBLISHED';
}

export interface IssueSearchResponse {
  query: string;
  items: IssueSearchItem[];
}
