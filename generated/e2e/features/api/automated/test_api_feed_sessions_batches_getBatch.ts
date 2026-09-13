import type { tags } from "typia";
import typia from "typia";

import type { FeedBatchRequest } from "../../../../../apps/api/src/issue/type/feed.request";
import type { FeedBatchResponse } from "../../../../../apps/api/src/issue/type/feed.response";
import api from "../../../../api";

export const test_api_feed_sessions_batches_getBatch = async (
  connection: api.IConnection,
) => {
  const output: FeedBatchResponse =
    await api.functional.feed_sessions.batches.getBatch(
      connection,
      typia.random<string & tags.Format<"uuid"> & tags.MinLength<1>>(),
      typia.random<FeedBatchRequest>(),
    );
  typia.assert(output);
};
