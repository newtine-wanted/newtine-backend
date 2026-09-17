import type {
  AuthUser,
  CreateAuthUserCommand,
  CreateRefreshSessionCommand,
  RotateRefreshSessionCommand,
  RotateRefreshSessionResult,
} from '../domain/auth.model.js';
import type { UuidV7 } from '../../common/id/uuidV7.generator.js';

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | undefined>;
  findUserById(userId: UuidV7): Promise<AuthUser | undefined>;
  createUser(command: CreateAuthUserCommand): Promise<AuthUser>;
  deleteUser(userId: UuidV7): Promise<boolean>;
  createRefreshSession(command: CreateRefreshSessionCommand): Promise<void>;
  rotateRefreshSession(command: RotateRefreshSessionCommand): Promise<RotateRefreshSessionResult>;
  revokeRefreshSession(tokenHash: string, revokedAt: Date): Promise<void>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
