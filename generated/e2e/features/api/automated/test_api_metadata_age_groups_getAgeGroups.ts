import typia from "typia";

import type { MetadataAgeGroupCollectionResponse } from "../../../../../apps/api/src/metadata/type/metadata.response";
import api from "../../../../api";

export const test_api_metadata_age_groups_getAgeGroups = async (
  connection: api.IConnection,
) => {
  const output: MetadataAgeGroupCollectionResponse =
    await api.functional.metadata.age_groups.getAgeGroups(connection);
  typia.assert(output);
};
