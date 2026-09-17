import typia from "typia";

import api from "../../../../api";

export const test_api_auth_withdraw = async (connection: api.IConnection) => {
  const output = await api.functional.auth.withdraw(connection);
  typia.assert(output);
};
