import typia from "typia";

import type { FeedSessionCreateRequest } from "../../../../../apps/api/src/issue/type/feed.request";
import type { FeedSessionResponse } from "../../../../../apps/api/src/issue/type/feed.response";
import api from "../../../../api";

export const test_api_feed_sessions_create = async (
  connection: api.IConnection,
) => {
  const output: FeedSessionResponse = await api.functional.feed_sessions.create(
    connection,
    typia.random<FeedSessionCreateRequest>(),
  );
  typia.assert(output);
};
