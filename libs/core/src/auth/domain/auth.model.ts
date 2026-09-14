import type { UuidV7 } from '../../common/id/uuidV7.generator.js';

export const AuthRole = {
  User: 'USER',
  Admin: 'ADMIN',
} as const;

export type AuthRoleValue = (typeof AuthRole)[keyof typeof AuthRole];

/** Persistence projection used by the authentication application layer. */
export interface AuthUser {
  readonly id: UuidV7;
  readonly email: string | null;
  readonly passwordHash: string | null;
  readonly role: AuthRoleValue;
}

/** Credential-bearing account projection with legacy nullable fields resolved. */
export interface AuthAccount {
  readonly id: UuidV7;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: AuthRoleValue;
}

/** Session response projection; it intentionally does not require a password hash. */
export interface AuthSessionUser {
  readonly id: UuidV7;
  readonly email: string;
  readonly role: AuthRoleValue;
}

/** Request principal produced after access-token verification and current-role lookup. */
export interface AuthPrincipal {
  readonly userId: UuidV7;
  readonly role: AuthRoleValue;
}

export interface CreateAuthUserCommand {
  readonly id: UuidV7;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: AuthRoleValue;
  readonly createdAt: Date;
}

export interface CreateRefreshSessionCommand {
  readonly id: UuidV7;
  readonly userId: UuidV7;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface RotateRefreshSessionCommand {
  readonly tokenHash: string;
  readonly replacement: Omit<CreateRefreshSessionCommand, 'userId'>;
  readonly now: Date;
}

export type RotateRefreshSessionResult =
  | { readonly status: 'rotated'; readonly user: AuthUser }
  | { readonly status: 'invalid' }
  | { readonly status: 'reused' };

/** Converts the legacy nullable persistence projection into a valid credential account. */
export function toAuthAccount(user: AuthUser): AuthAccount | undefined {
  if (user.email === null || user.passwordHash === null) {
    return undefined;
  }
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
  };
}

/** Resolves only the fields required to issue a session response. */
export function toAuthSessionUser(user: AuthUser): AuthSessionUser | undefined {
  if (user.email === null) {
    return undefined;
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
  };
}

/** Converts a persistence user into the only principal shape accepted by guards. */
export function toAuthPrincipal(user: Pick<AuthUser, 'id' | 'role'>): AuthPrincipal {
  return { userId: user.id, role: user.role };
}
