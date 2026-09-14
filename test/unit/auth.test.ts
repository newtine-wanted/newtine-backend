import 'reflect-metadata';

import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  AuthException,
  AuthExceptionCode,
  AuthRole,
  type AuthRepository,
  type AuthUser,
} from '@newtine/core';
import { AUTH_ROLES_KEY } from '@newtine/api/auth/auth.decorator.js';
import {
  clearRefreshCookie,
  readRefreshToken,
  setRefreshCookie,
} from '@newtine/api/auth/auth.cookie.js';
import { createAuthOptions } from '@newtine/api/auth/auth.options.js';
import type { AuthenticatedRequest } from '@newtine/api/auth/auth.request.js';
import { AuthService } from '@newtine/api/auth/auth.service.js';
import { JwtAuthGuard } from '@newtine/api/auth/jwt-auth.guard.js';
import { JwtTokenService } from '@newtine/api/auth/jwt-token.service.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordService,
} from '@newtine/api/auth/password.service.js';
import { RolesGuard } from '@newtine/api/auth/roles.guard.js';
import { assertAllowedOrigin } from '@newtine/api/auth/auth.origin.js';

const SECRET = 'test-jwt-secret-that-is-longer-than-32-bytes';
const immediateTransactionManager = {
  execute<T>(work: () => Promise<T>): Promise<T> {
    return work();
  },
};

test('PasswordService uses Argon2id hashes and rejects password length boundaries', async () => {
  const service = new PasswordService();
  const password = 'correct horse battery staple';
  const passwordHash = await service.hash(password);

  assert.match(passwordHash, /^\$argon2id\$/);
  assert.equal(await service.verify(password, passwordHash), true);
  assert.equal(await service.verify(`${password}!`, passwordHash), false);
  await assert.rejects(service.hash('x'.repeat(PASSWORD_MIN_LENGTH - 1)), AuthException);
  await assert.rejects(service.hash('x'.repeat(PASSWORD_MAX_LENGTH + 1)), AuthException);
  await assert.doesNotReject(service.hash(' '.repeat(PASSWORD_MIN_LENGTH)));
});

test('createAuthOptions requires a production secret and enforces secure cookies', () => {
  const options = createAuthOptions({
    NODE_ENV: 'production',
    JWT_SECRET: SECRET,
    AUTH_ALLOWED_ORIGINS: 'https://app.example.com',
  });
  assert.equal(options.cookieSecure, true);
  assert.deepEqual(options.allowedOrigins, ['https://app.example.com']);
  assert.equal(options.accessTokenTtlSeconds, 900);
  assert.equal(options.refreshTokenTtlSeconds, 2_592_000);

  assert.throws(() => createAuthOptions({ NODE_ENV: 'production' }), /JWT_SECRET must be set/);
  assert.throws(
    () =>
      createAuthOptions({
        NODE_ENV: 'production',
        JWT_SECRET: SECRET,
        AUTH_COOKIE_SECURE: 'false',
      }),
    /AUTH_COOKIE_SECURE must be true in production/,
  );
});

test('JwtTokenService fixes the algorithm, issuer, audience and UUIDv7 subject', async () => {
  const options = createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  const service = new JwtTokenService(options as never);
  const userId = '0199f000-0000-7000-8000-000000000001';
  const token = await service.signAccessToken(userId);

  assert.equal(await service.verifyAccessToken(token), userId);
  await assert.rejects(
    new JwtTokenService({
      ...options,
      jwtAudience: 'wrong-audience',
    } as never).verifyAccessToken(token),
  );
});

test('AuthService canonicalizes email, always creates USER signup sessions, and stores no plaintext password', async () => {
  const userId = '0199f000-0000-7000-8000-000000000001' as AuthUser['id'];
  const sessions: unknown[] = [];
  const createdUsers: unknown[] = [];
  const repository: AuthRepository = {
    findUserByEmail: async () => undefined,
    findUserById: async () => undefined,
    createUser: async (command) => {
      createdUsers.push(command);
      return {
        id: userId,
        email: command.email,
        passwordHash: command.passwordHash,
        role: command.role,
      };
    },
    createRefreshSession: async (command) => {
      sessions.push(command);
    },
    rotateRefreshSession: async () => ({ status: 'invalid' }),
    revokeRefreshSession: async () => undefined,
  };
  const options = createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  const passwordService = {
    hash: async () => 'argon2id$stored-hash',
    verify: async () => true,
  } as unknown as PasswordService;
  const jwtTokenService = {
    signAccessToken: async () => 'access-token',
  } as unknown as JwtTokenService;
  const service = new AuthService(
    repository,
    immediateTransactionManager,
    options,
    passwordService,
    jwtTokenService,
  );

  const result = await service.signup({
    email: '  USER@Example.COM ',
    password: 'password-that-is-never-stored',
  });

  assert.equal(result.user.email, 'user@example.com');
  assert.equal(result.user.role, AuthRole.User);
  assert.equal(result.refreshToken.length, 43);
  assert.equal(createdUsers.length, 1);
  assert.equal(sessions.length, 1);
  assert.doesNotMatch(JSON.stringify(sessions), /password-that-is-never-stored/);
  assert.doesNotMatch(JSON.stringify(createdUsers), /password-that-is-never-stored/);
});

test('AuthService maps a canonical email race to a conflict', async () => {
  const repository: AuthRepository = {
    findUserByEmail: async () => undefined,
    findUserById: async () => undefined,
    createUser: async () => {
      const error = Object.assign(new Error('duplicate'), {
        code: '23505',
        constraint: 'users_email_canonical_unique',
      });
      throw error;
    },
    createRefreshSession: async () => undefined,
    rotateRefreshSession: async () => ({ status: 'invalid' }),
    revokeRefreshSession: async () => undefined,
  };
  const options = createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  const service = new AuthService(
    repository,
    immediateTransactionManager,
    options,
    { hash: async () => 'hash', verify: async () => true } as unknown as PasswordService,
    { signAccessToken: async () => 'access' } as unknown as JwtTokenService,
  );

  await assert.rejects(
    service.signup({ email: 'new@example.com', password: 'password-that-is-valid' }),
    (error: unknown) =>
      error instanceof AuthException && error.code === AuthExceptionCode.DuplicateEmail,
  );
});

test('AuthService rotates an opaque refresh token and never returns it in the access response', async () => {
  const user = {
    id: '0199f000-0000-7000-8000-000000000001',
    email: 'user@example.com',
    passwordHash: 'hash',
    role: AuthRole.User,
  } as AuthUser;
  let rotationCommand: unknown;
  const repository: AuthRepository = {
    findUserByEmail: async () => undefined,
    findUserById: async () => user,
    createUser: async () => user,
    createRefreshSession: async () => undefined,
    rotateRefreshSession: async (command) => {
      rotationCommand = command;
      return { status: 'rotated', user };
    },
    revokeRefreshSession: async () => undefined,
  };
  const options = createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  const service = new AuthService(
    repository,
    immediateTransactionManager,
    options,
    { hash: async () => 'hash', verify: async () => true } as unknown as PasswordService,
    { signAccessToken: async () => 'new-access-token' } as unknown as JwtTokenService,
  );
  const oldRefresh = 'a'.repeat(43);

  const result = await service.refresh(oldRefresh);

  assert.equal(result.accessToken, 'new-access-token');
  assert.equal(result.user.email, 'user@example.com');
  assert.equal(Object.hasOwn(result, 'refreshToken'), true);
  assert.equal(result.refreshToken.length, 43);
  assert.notEqual(result.refreshToken, oldRefresh);
  assert.equal(typeof rotationCommand, 'object');
  assert.equal(JSON.stringify(rotationCommand).includes(oldRefresh), false);
});

test('AuthService turns refresh reuse into one generic unauthorized domain error', async () => {
  const repository: AuthRepository = {
    findUserByEmail: async () => undefined,
    findUserById: async () => undefined,
    createUser: async () => {
      throw new Error('not used');
    },
    createRefreshSession: async () => undefined,
    rotateRefreshSession: async () => ({ status: 'reused' }),
    revokeRefreshSession: async () => undefined,
  };
  const options = createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  const service = new AuthService(
    repository,
    immediateTransactionManager,
    options,
    { hash: async () => 'hash', verify: async () => true } as unknown as PasswordService,
    { signAccessToken: async () => 'access' } as unknown as JwtTokenService,
  );

  await assert.rejects(
    service.refresh('a'.repeat(43)),
    (error: unknown) =>
      error instanceof AuthException && error.code === AuthExceptionCode.InvalidRefreshToken,
  );
});

test('JwtAuthGuard verifies the bearer token and refreshes the current DB role on the request', async () => {
  const request = {
    headers: { authorization: 'Bearer signed-token' },
  } as AuthenticatedRequest;
  const context = createHttpContext(request);
  const guard = new JwtAuthGuard(
    { verifyAccessToken: async () => '0199f000-0000-7000-8000-000000000001' } as never,
    {
      findUserById: async () => ({
        id: '0199f000-0000-7000-8000-000000000001',
        email: 'user@example.com',
        passwordHash: null,
        role: AuthRole.Admin,
      }),
    } as never,
  );

  assert.equal(await guard.canActivate(context as never), true);
  assert.equal(request.authenticatedUserId, '0199f000-0000-7000-8000-000000000001');
  assert.equal(request.authenticatedUserRole, AuthRole.Admin);

  await assert.rejects(
    new JwtAuthGuard({ verifyAccessToken: async () => 'never' } as never, {} as never).canActivate(
      createHttpContext({ headers: {} } as AuthenticatedRequest) as never,
    ),
    UnauthorizedException,
  );
});

test('RolesGuard returns 403 for a USER on an ADMIN route and accepts the current ADMIN role', () => {
  const handler = () => undefined;
  Reflect.defineMetadata(AUTH_ROLES_KEY, [AuthRole.Admin], handler);
  const guard = new RolesGuard(new Reflector());
  const userRequest = {
    authenticatedUserId: '0199f000-0000-7000-8000-000000000001',
    authenticatedUserRole: AuthRole.User,
  } as AuthenticatedRequest;

  assert.throws(
    () => guard.canActivate(createHttpContext(userRequest, handler) as never),
    ForbiddenException,
  );

  userRequest.authenticatedUserRole = AuthRole.Admin;
  assert.equal(guard.canActivate(createHttpContext(userRequest, handler) as never), true);
});

test('Origin validation allows same-origin requests and rejects cross-origin cookie writes', () => {
  const options = createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  const sameOrigin = {
    headers: { origin: 'http://localhost:3000' },
    protocol: 'http',
    get: () => 'localhost:3000',
  } as never;
  assert.doesNotThrow(() => assertAllowedOrigin(sameOrigin, options));

  const crossOrigin = {
    headers: { origin: 'https://evil.example' },
    protocol: 'http',
    get: () => 'localhost:3000',
  } as never;
  assert.throws(() => assertAllowedOrigin(crossOrigin, options), ForbiddenException);
});

test('refresh cookie helpers apply the security attributes and can clear the session', () => {
  const options = createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  const refreshToken = 'r'.repeat(43);
  const headers: Record<string, string> = {};
  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as never;

  setRefreshCookie(response, refreshToken, options);
  assert.match(headers['Set-Cookie'] ?? '', /^newtine_refresh=r{43};/);
  assert.match(headers['Set-Cookie'] ?? '', /Path=\/auth/);
  assert.match(headers['Set-Cookie'] ?? '', /HttpOnly/);
  assert.match(headers['Set-Cookie'] ?? '', /SameSite=Lax/);
  assert.match(headers['Set-Cookie'] ?? '', /Max-Age=2592000/);

  const request = { headers: { cookie: `other=x; newtine_refresh=${refreshToken}` } } as never;
  assert.equal(readRefreshToken(request, options), refreshToken);

  clearRefreshCookie(response, options);
  assert.match(headers['Set-Cookie'] ?? '', /Max-Age=0/);
  assert.match(headers['Set-Cookie'] ?? '', /Expires=Thu, 01 Jan 1970/);
});

function createHttpContext(
  request: AuthenticatedRequest,
  handler: () => undefined = () => undefined,
): {
  switchToHttp: () => { getRequest: () => AuthenticatedRequest };
  getHandler: () => () => undefined;
  getClass: () => typeof Object;
} {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => Object,
  };
}
