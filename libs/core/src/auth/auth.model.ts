import type { UuidV7 } from '../common/id/uuidV7.generator.js';

export const AuthRole = {
  User: 'USER',
  Admin: 'ADMIN',
} as const;

export type AuthRoleValue = (typeof AuthRole)[keyof typeof AuthRole];

export interface AuthUser {
  readonly id: UuidV7;
  readonly email: string | null;
  readonly passwordHash: string | null;
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

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | undefined>;
  findUserById(userId: string): Promise<AuthUser | undefined>;
  createUser(command: CreateAuthUserCommand): Promise<AuthUser>;
  createRefreshSession(command: CreateRefreshSessionCommand): Promise<void>;
  rotateRefreshSession(command: RotateRefreshSessionCommand): Promise<RotateRefreshSessionResult>;
  revokeRefreshSession(tokenHash: string, revokedAt: Date): Promise<void>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
