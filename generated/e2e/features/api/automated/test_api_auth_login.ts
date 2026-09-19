import typia from "typia";

import type { AuthOriginHeaders } from "../../../../../apps/api/src/auth/auth.origin";
import type {
  AuthCredentialsRequest,
  AuthSessionResponse,
} from "../../../../../apps/api/src/auth/auth.type";
import api from "../../../../api";

export const test_api_auth_login = async (connection: api.IConnection) => {
  const output: AuthSessionResponse = await api.functional.auth.login(
    {
      ...connection,
      headers: {
        ...connection.headers,
        ...typia.random<AuthOriginHeaders>(),
      },
    },
    typia.random<AuthCredentialsRequest>(),
  );
  typia.assert(output);
};
