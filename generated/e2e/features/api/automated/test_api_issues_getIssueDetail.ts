import type { tags } from "typia";
import typia from "typia";

import type { IssueDetailResponse } from "../../../../../apps/api/src/issue/type/issueDetail.response";
import api from "../../../../api";

export const test_api_issues_getIssueDetail = async (
  connection: api.IConnection,
) => {
  const output: IssueDetailResponse =
    await api.functional.issues.getIssueDetail(
      connection,
      typia.random<string & tags.Format<"uuid"> & tags.MinLength<1>>(),
    );
  typia.assert(output);
};
