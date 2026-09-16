import type { tags } from "typia";
import typia from "typia";

import type { DetailViewProgressRequest } from "../../../../../apps/api/src/issue/type/issueAction.request";
import type { DetailViewProgressResponse } from "../../../../../apps/api/src/issue/type/issueAction.response";
import api from "../../../../api";

export const test_api_issues_detail_views_progress_updateDetailView = async (
  connection: api.IConnection,
) => {
  const output: DetailViewProgressResponse =
    await api.functional.issues.detail_views.progress.updateDetailView(
      connection,
      typia.random<string & tags.Format<"uuid"> & tags.MinLength<1>>(),
      typia.random<string & tags.Format<"uuid"> & tags.MinLength<1>>(),
      typia.random<DetailViewProgressRequest>(),
    );
  typia.assert(output);
};
