import typia from "typia";

import type { IssueSearchRequest } from "../../../../../apps/api/src/issue/type/issueSearch.request";
import type { IssueSearchResponse } from "../../../../../apps/api/src/issue/type/issueSearch.response";
import api from "../../../../api";

export const test_api_issues_search = async (connection: api.IConnection) => {
  const output: IssueSearchResponse = await api.functional.issues.search(
    connection,
    typia.random<IssueSearchRequest>(),
  );
  typia.assert(output);
};
