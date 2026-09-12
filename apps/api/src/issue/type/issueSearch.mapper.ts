import type { IssueSearchInput } from '@newtine/api/issue/type/issueSearch.input.js';
import type { IssueSearchResult } from '@newtine/api/issue/type/issueSearch.output.js';
import type { IssueSearchRequest } from '@newtine/api/issue/type/issueSearch.request.js';
import type { IssueSearchResponse } from '@newtine/api/issue/type/issueSearch.response.js';

export function toIssueSearchInput(request: IssueSearchRequest): IssueSearchInput {
  return {
    keyword: request.query,
    pageSize: request.limit,
  };
}

export function toIssueSearchResponse(result: IssueSearchResult): IssueSearchResponse {
  return {
    query: result.keyword,
    items: result.items.map((item) => ({
      id: item.id as IssueSearchResponse['items'][number]['id'],
      title: item.title,
      publicationStatus: item.status,
    })),
  };
}
