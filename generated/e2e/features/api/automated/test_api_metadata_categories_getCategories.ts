import typia from "typia";

import type { MetadataCategoryCollectionResponse } from "../../../../../apps/api/src/metadata/type/metadata.response";
import api from "../../../../api";

export const test_api_metadata_categories_getCategories = async (
  connection: api.IConnection,
) => {
  const output: MetadataCategoryCollectionResponse =
    await api.functional.metadata.categories.getCategories(connection);
  typia.assert(output);
};
