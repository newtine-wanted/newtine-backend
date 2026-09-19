import typia from "typia";

import type { MetadataRegionCollectionResponse } from "../../../../../apps/api/src/metadata/type/metadata.response";
import api from "../../../../api";

export const test_api_metadata_regions_getRegions = async (
  connection: api.IConnection,
) => {
  const output: MetadataRegionCollectionResponse =
    await api.functional.metadata.regions.getRegions(connection);
  typia.assert(output);
};
