import type { tags } from "typia";
import typia from "typia";

import type { DetailViewStartRequest } from "../../../../../apps/api/src/issue/type/issueAction.request";
import type { DetailViewStartResponse } from "../../../../../apps/api/src/issue/type/issueAction.response";
import api from "../../../../api";

export const test_api_issues_detail_views_startDetailView = async (
  connection: api.IConnection,
) => {
  const output: DetailViewStartResponse =
    await api.functional.issues.detail_views.startDetailView(
      connection,
      typia.random<string & tags.Format<"uuid"> & tags.MinLength<1>>(),
      typia.random<string & tags.Format<"uuid"> & tags.MinLength<1>>(),
      typia.random<DetailViewStartRequest>(),
    );
  typia.assert(output);
};
