import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  AUTH_REPOSITORY,
  AuthException,
  AuthExceptionCode,
  AuthRole,
  generateUuidV7,
  TRANSACTION_MANAGER,
  type AuthRepository,
  type AuthUser,
  type CreateRefreshSessionCommand,
  type TransactionManager,
} from '@newtine/core';

import { AUTH_OPTIONS, type AuthOptions } from './auth.options.js';
import { JwtTokenService } from './jwt-token.service.js';
import { assertPasswordLength, PasswordService } from './password.service.js';

export interface AuthCredentialsInput {
  readonly email: string;
  readonly password: string;
}

export interface AuthPublicUser {
  readonly id: string;
  readonly email: string;
  readonly role: 'USER' | 'ADMIN';
}

export interface AuthSessionResult {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly user: AuthPublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    private readonly passwordService: PasswordService,
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  async signup(input: AuthCredentialsInput): Promise<AuthSessionResult> {
    const email = canonicalizeEmail(input.email);
    const passwordHash = await this.passwordService.hash(input.password);
    const userId = generateUuidV7();
    const now = new Date();
    const refresh = createRefreshSession(userId, now, this.options);
    const accessToken = await this.jwtTokenService.signAccessToken(userId);

    let user: AuthUser;
    try {
      user = await this.transactionManager.execute(async () => {
        const createdUser = await this.authRepository.createUser({
          id: userId,
          email,
          passwordHash,
          role: AuthRole.User,
          createdAt: now,
        });
        await this.authRepository.createRefreshSession(refresh.command);
        return createdUser;
      });
    } catch (error) {
      if (isEmailUniqueViolation(error)) {
        throw new AuthException(AuthExceptionCode.DuplicateEmail, '이미 사용 중인 이메일입니다.', {
          cause: error,
        });
      }
      throw error;
    }

    return this.toSessionResult(user, accessToken, refresh.token);
  }

  async login(input: AuthCredentialsInput): Promise<AuthSessionResult> {
    const email = canonicalizeEmail(input.email);
    assertPasswordLength(input.password);
    const user = await this.authRepository.findUserByEmail(email);
    if (
      user === undefined ||
      user.email === null ||
      user.passwordHash === null ||
      !(await this.passwordService.verify(input.password, user.passwordHash))
    ) {
      throw invalidCredentials();
    }

    const now = new Date();
    const refresh = createRefreshSession(user.id, now, this.options);
    const accessToken = await this.jwtTokenService.signAccessToken(user.id);
    await this.transactionManager.execute(() =>
      this.authRepository.createRefreshSession(refresh.command),
    );

    return this.toSessionResult(user, accessToken, refresh.token);
  }

  async refresh(refreshToken: string | undefined): Promise<AuthSessionResult> {
    if (!isRefreshToken(refreshToken)) {
      throw invalidRefreshToken();
    }

    const now = new Date();
    const replacement = createRefreshSessionReplacement(now, this.options);
    const result = await this.transactionManager.execute(async () => {
      const rotation = await this.authRepository.rotateRefreshSession({
        tokenHash: hashRefreshToken(refreshToken),
        replacement: replacement.command,
        now,
      });
      if (rotation.status !== 'rotated') {
        return rotation;
      }

      const accessToken = await this.jwtTokenService.signAccessToken(rotation.user.id);
      return {
        status: 'rotated' as const,
        session: this.toSessionResult(rotation.user, accessToken, replacement.token),
      };
    });

    if (result.status !== 'rotated') {
      throw invalidRefreshToken();
    }
    return result.session;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!isRefreshToken(refreshToken)) {
      return;
    }

    await this.transactionManager.execute(() =>
      this.authRepository.revokeRefreshSession(hashRefreshToken(refreshToken), new Date()),
    );
  }

  private toSessionResult(
    user: AuthUser,
    accessToken: string,
    refreshToken: string,
  ): AuthSessionResult {
    if (user.email === null) {
      throw invalidCredentials();
    }
    return {
      accessToken,
      expiresIn: this.options.accessTokenTtlSeconds,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }
}

export function canonicalizeEmail(email: string): string {
  const canonical = email.trim().toLowerCase();
  if (
    canonical.length === 0 ||
    canonical.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(canonical)
  ) {
    throw new AuthException(AuthExceptionCode.InvalidEmail, '이메일 형식이 올바르지 않습니다.');
  }
  return canonical;
}

function createRefreshSession(
  userId: string,
  now: Date,
  options: AuthOptions,
): { readonly token: string; readonly command: CreateRefreshSessionCommand } {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    command: {
      id: generateUuidV7(),
      userId: userId as CreateRefreshSessionCommand['userId'],
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(now.getTime() + options.refreshTokenTtlSeconds * 1000),
      createdAt: now,
    },
  };
}

function createRefreshSessionReplacement(
  now: Date,
  options: AuthOptions,
): {
  readonly token: string;
  readonly command: Omit<CreateRefreshSessionCommand, 'userId'>;
} {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    command: {
      id: generateUuidV7(),
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(now.getTime() + options.refreshTokenTtlSeconds * 1000),
      createdAt: now,
    },
  };
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isRefreshToken(token: string | undefined): token is string {
  return token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function invalidCredentials(): AuthException {
  return new AuthException(
    AuthExceptionCode.InvalidCredentials,
    '이메일 또는 비밀번호가 올바르지 않습니다.',
  );
}

function invalidRefreshToken(): AuthException {
  return new AuthException(
    AuthExceptionCode.InvalidRefreshToken,
    'refresh token이 유효하지 않습니다.',
  );
}

function isEmailUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { readonly code?: unknown; readonly constraint?: unknown };
  return (
    candidate.code === '23505' &&
    typeof candidate.constraint === 'string' &&
    candidate.constraint.includes('users_email')
  );
}
