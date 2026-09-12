import { Injectable } from '@nestjs/common';

import type { IssueSearchInput } from '@newtine/api/issue/type/issueSearch.input.js';
import type { IssueSearchResult } from '@newtine/api/issue/type/issueSearch.output.js';

@Injectable()
export class IssueSearchService {
  search(input: IssueSearchInput): IssueSearchResult {
    return {
      keyword: input.keyword,
      items: [],
    };
  }
}
