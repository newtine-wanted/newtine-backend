import type { AuthSessionUser } from '@newtine/core';

import type { AuthSessionResult } from './auth.types.js';

/** Pure projection from a valid account and issued tokens to the application result. */
export function toAuthSessionResult(
  user: AuthSessionUser,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): AuthSessionResult {
  return {
    accessToken,
    expiresIn,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
}
