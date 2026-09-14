import typia from "typia";

import api from "../../../../api";

export const test_api_auth_logout = async (connection: api.IConnection) => {
  const output = await api.functional.auth.logout(connection);
  typia.assert(output);
};
