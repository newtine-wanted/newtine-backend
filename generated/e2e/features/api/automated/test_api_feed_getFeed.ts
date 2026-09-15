import typia from "typia";

import type { FeedRequest } from "../../../../../apps/api/src/issue/type/feed.request";
import type { FeedResponse } from "../../../../../apps/api/src/issue/type/feed.response";
import api from "../../../../api";

export const test_api_feed_getFeed = async (connection: api.IConnection) => {
  const output: FeedResponse = await api.functional.feed.getFeed(
    connection,
    typia.random<FeedRequest>(),
  );
  typia.assert(output);
};
