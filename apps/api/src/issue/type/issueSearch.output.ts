export interface IssueSearchResultItem {
  id: string;
  title: string;
  status: 'PUBLISHED';
}

export interface IssueSearchResult {
  keyword: string;
  items: IssueSearchResultItem[];
}
