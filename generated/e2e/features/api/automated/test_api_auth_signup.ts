import typia from "typia";

import type {
  AuthCredentialsRequest,
  AuthSessionResponse,
} from "../../../../../apps/api/src/auth/auth.type";
import api from "../../../../api";

export const test_api_auth_signup = async (connection: api.IConnection) => {
  const output: AuthSessionResponse = await api.functional.auth.signup(
    connection,
    typia.random<AuthCredentialsRequest>(),
  );
  typia.assert(output);
};
