import type { AuthRoleValue } from '@newtine/core';

export interface AuthCredentialsInput {
  readonly email: string;
  readonly password: string;
}

export interface AuthPublicUser {
  readonly id: string;
  readonly email: string;
  readonly role: AuthRoleValue;
}

/** Internal session result. The refresh token is removed by the HTTP adapter. */
export interface AuthSessionResult {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly user: AuthPublicUser;
}
