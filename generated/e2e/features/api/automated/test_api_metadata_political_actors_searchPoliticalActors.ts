import typia from "typia";

import type { PoliticalActorQuery } from "../../../../../apps/api/src/metadata/type/metadata.request";
import type { PoliticalActorSearchResponse } from "../../../../../apps/api/src/metadata/type/metadata.response";
import api from "../../../../api";

export const test_api_metadata_political_actors_searchPoliticalActors = async (
  connection: api.IConnection,
) => {
  const output: PoliticalActorSearchResponse =
    await api.functional.metadata.political_actors.searchPoliticalActors(
      connection,
      typia.random<PoliticalActorQuery>(),
    );
  typia.assert(output);
};
