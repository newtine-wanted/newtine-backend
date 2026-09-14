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
import { AccessPrincipalService } from '@newtine/api/auth/application/access-principal.service.js';
import { LoginUseCase } from '@newtine/api/auth/application/login.usecase.js';
import { RefreshUseCase } from '@newtine/api/auth/application/refresh.usecase.js';
import { SessionIssuer } from '@newtine/api/auth/application/session-issuer.js';
import { SignupUseCase } from '@newtine/api/auth/application/signup.usecase.js';
import { EmailAddress } from '@newtine/api/auth/domain/email-address.js';
import type { AuthenticatedRequest } from '@newtine/api/auth/auth.request.js';
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

test('PasswordService가 Argon2id 해시를 사용하고 비밀번호 길이 경계를 거부한다', async () => {
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

test('createAuthOptions가 운영 환경의 secret을 요구하고 Secure 쿠키를 강제한다', () => {
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

test('EmailAddress가 입력 이메일을 canonical value로 만들고 잘못된 형식을 거부한다', () => {
  assert.equal(EmailAddress.create('  USER@Example.COM ').value, 'user@example.com');
  assert.throws(() => EmailAddress.create('invalid-email'), AuthException);
});

test('JwtTokenService가 알고리즘·issuer·audience와 UUIDv7 subject를 고정한다', async () => {
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

test('SignupUseCase가 이메일을 정규화하고 가입 계정을 항상 USER로 만들며 평문 비밀번호를 저장하지 않는다', async () => {
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
  const useCase = new SignupUseCase(
    repository,
    immediateTransactionManager,
    passwordService,
    new SessionIssuer(options, jwtTokenService),
  );

  const result = await useCase.execute({
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

test('LoginUseCase가 canonical email을 조회하고 검증된 계정에 새 session을 발급한다', async () => {
  const user = {
    id: '0199f000-0000-7000-8000-000000000001',
    email: 'user@example.com',
    passwordHash: 'argon2id-hash',
    role: AuthRole.User,
  } as AuthUser;
  let lookedUpEmail: string | undefined;
  let createdSession = false;
  const repository: AuthRepository = {
    findUserByEmail: async (email) => {
      lookedUpEmail = email;
      return user;
    },
    findUserById: async () => user,
    createUser: async () => user,
    createRefreshSession: async () => {
      createdSession = true;
    },
    rotateRefreshSession: async () => ({ status: 'invalid' }),
    revokeRefreshSession: async () => undefined,
  };
  const options = createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  const useCase = new LoginUseCase(
    repository,
    immediateTransactionManager,
    { hash: async () => 'unused', verify: async () => true } as unknown as PasswordService,
    new SessionIssuer(options, { signAccessToken: async () => 'access-token' } as never),
  );

  const result = await useCase.execute({
    email: ' USER@Example.COM ',
    password: 'password-that-is-valid',
  });

  assert.equal(lookedUpEmail, 'user@example.com');
  assert.equal(createdSession, true);
  assert.equal(result.user.email, 'user@example.com');
  assert.equal(result.accessToken, 'access-token');
});

test('SignupUseCase가 canonical email 생성 경쟁을 충돌 오류로 변환한다', async () => {
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
  const useCase = new SignupUseCase(
    repository,
    immediateTransactionManager,
    { hash: async () => 'hash', verify: async () => true } as unknown as PasswordService,
    new SessionIssuer(options, { signAccessToken: async () => 'access' } as never),
  );

  await assert.rejects(
    useCase.execute({ email: 'new@example.com', password: 'password-that-is-valid' }),
    (error: unknown) =>
      error instanceof AuthException && error.code === AuthExceptionCode.DuplicateEmail,
  );
});

test('RefreshUseCase가 opaque refresh token을 회전하고 access 응답에 반환하지 않는다', async () => {
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
  const useCase = new RefreshUseCase(
    repository,
    immediateTransactionManager,
    new SessionIssuer(options, { signAccessToken: async () => 'new-access-token' } as never),
  );
  const oldRefresh = 'a'.repeat(43);

  const result = await useCase.execute(oldRefresh);

  assert.equal(result.accessToken, 'new-access-token');
  assert.equal(result.user.email, 'user@example.com');
  assert.equal(Object.hasOwn(result, 'refreshToken'), true);
  assert.equal(result.refreshToken.length, 43);
  assert.notEqual(result.refreshToken, oldRefresh);
  assert.equal(typeof rotationCommand, 'object');
  assert.equal(JSON.stringify(rotationCommand).includes(oldRefresh), false);
});

test('RefreshUseCase가 refresh token 재사용을 일반화된 인증 실패 도메인 오류로 변환한다', async () => {
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
  const useCase = new RefreshUseCase(
    repository,
    immediateTransactionManager,
    new SessionIssuer(options, { signAccessToken: async () => 'access' } as never),
  );

  await assert.rejects(
    useCase.execute('a'.repeat(43)),
    (error: unknown) =>
      error instanceof AuthException && error.code === AuthExceptionCode.InvalidRefreshToken,
  );
});

test('JwtAuthGuard가 Bearer token을 검증하고 요청에 DB의 현재 role을 주입한다', async () => {
  const request = {
    headers: { authorization: 'Bearer signed-token' },
  } as AuthenticatedRequest;
  const context = createHttpContext(request);
  const guard = new JwtAuthGuard(
    new AccessPrincipalService(
      { verifyAccessToken: async () => '0199f000-0000-7000-8000-000000000001' } as never,
      {
        findUserById: async () => ({
          id: '0199f000-0000-7000-8000-000000000001',
          email: 'user@example.com',
          passwordHash: null,
          role: AuthRole.Admin,
        }),
      } as never,
    ),
  );

  assert.equal(await guard.canActivate(context as never), true);
  assert.deepEqual(request.principal, {
    userId: '0199f000-0000-7000-8000-000000000001' as AuthUser['id'],
    role: AuthRole.Admin,
  });

  await assert.rejects(
    new JwtAuthGuard(
      new AccessPrincipalService({ verifyAccessToken: async () => 'never' } as never, {} as never),
    ).canActivate(createHttpContext({ headers: {} } as AuthenticatedRequest) as never),
    UnauthorizedException,
  );
});

test('RolesGuard가 ADMIN route의 USER 요청을 403으로 거부하고 현재 ADMIN role을 허용한다', () => {
  const handler = () => undefined;
  Reflect.defineMetadata(AUTH_ROLES_KEY, [AuthRole.Admin], handler);
  const guard = new RolesGuard(new Reflector());
  const userRequest = {
    principal: {
      userId: '0199f000-0000-7000-8000-000000000001' as AuthUser['id'],
      role: AuthRole.User,
    },
  } as AuthenticatedRequest;

  assert.throws(
    () => guard.canActivate(createHttpContext(userRequest, handler) as never),
    ForbiddenException,
  );

  userRequest.principal = {
    userId: '0199f000-0000-7000-8000-000000000001' as AuthUser['id'],
    role: AuthRole.Admin,
  };
  assert.equal(guard.canActivate(createHttpContext(userRequest, handler) as never), true);
});

test('Origin 검증이 same-origin 요청을 허용하고 cross-origin 쿠키 쓰기를 거부한다', () => {
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

test('refresh cookie helper가 보안 속성을 적용하고 세션 쿠키를 삭제할 수 있다', () => {
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
