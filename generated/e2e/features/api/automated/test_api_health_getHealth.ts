import typia from "typia";

import api from "../../../../api";

export const test_api_health_getHealth = async (
  connection: api.IConnection,
) => {
  const output: { status: "ok" } =
    await api.functional.health.getHealth(connection);
  typia.assert(output);
};
