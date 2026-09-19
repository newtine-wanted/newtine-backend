import typia from "typia";

import type { AuthOriginHeaders } from "../../../../../apps/api/src/auth/auth.origin";
import api from "../../../../api";

export const test_api_auth_withdraw = async (connection: api.IConnection) => {
  const output = await api.functional.auth.withdraw({
    ...connection,
    headers: {
      ...connection.headers,
      ...typia.random<AuthOriginHeaders>(),
    },
  });
  typia.assert(output);
};
