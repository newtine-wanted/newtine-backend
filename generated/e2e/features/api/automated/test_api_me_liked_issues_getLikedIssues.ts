import typia from "typia";

import type { LikedIssuesResponse } from "../../../../../apps/api/src/interest/type/interest.output";
import type { LikedIssuesQuery } from "../../../../../apps/api/src/interest/type/interest.request";
import api from "../../../../api";

export const test_api_me_liked_issues_getLikedIssues = async (
  connection: api.IConnection,
) => {
  const output: LikedIssuesResponse =
    await api.functional.me.liked_issues.getLikedIssues(
      connection,
      typia.random<LikedIssuesQuery>(),
    );
  typia.assert(output);
};
