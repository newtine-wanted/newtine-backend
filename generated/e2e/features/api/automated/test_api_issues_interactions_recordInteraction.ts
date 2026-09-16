import type { tags } from "typia";
import typia from "typia";

import type { IssueInteractionRequest } from "../../../../../apps/api/src/issue/type/issueAction.request";
import type { IssueInteractionResponse } from "../../../../../apps/api/src/issue/type/issueAction.response";
import api from "../../../../api";

export const test_api_issues_interactions_recordInteraction = async (
  connection: api.IConnection,
) => {
  const output: IssueInteractionResponse =
    await api.functional.issues.interactions.recordInteraction(
      connection,
      typia.random<string & tags.Format<"uuid"> & tags.MinLength<1>>(),
      typia.random<IssueInteractionRequest>(),
    );
  typia.assert(output);
};
