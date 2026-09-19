import typia from "typia";

import type { AuthOriginHeaders } from "../../../../../apps/api/src/auth/auth.origin";
import type { AuthSessionResponse } from "../../../../../apps/api/src/auth/auth.type";
import api from "../../../../api";

export const test_api_auth_refresh = async (connection: api.IConnection) => {
  const output: AuthSessionResponse = await api.functional.auth.refresh({
    ...connection,
    headers: {
      ...connection.headers,
      ...typia.random<AuthOriginHeaders>(),
    },
  });
  typia.assert(output);
};
