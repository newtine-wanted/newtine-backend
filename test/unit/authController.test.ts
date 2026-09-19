import 'reflect-metadata';

import assert from 'node:assert/strict';
import { jest, test } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';

import type { AuthOptions } from '@newtine/api/auth/auth.options.js';
import { createAuthOptions } from '@newtine/api/auth/auth.options.js';
import type { AuthController } from '@newtine/api/auth/auth.controller.js';
import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

jest.unstable_mockModule('@nestia/core', () => ({
  TypedBody: () => () => undefined,
  TypedException: () => () => undefined,
  TypedHeaders: () => () => undefined,
  TypedRoute: { Post: () => () => undefined },
}));

const { AuthController: AuthControllerClass } = await import(
  '@newtine/api/auth/auth.controller.js'
);

const SECRET = 'test-jwt-secret-that-is-longer-than-32-bytes';
const REFRESH_TOKEN = 'r'.repeat(43);
const USER_ID = '0199f000-0000-7000-8000-000000000001' as UuidV7;

const SESSION = {
  accessToken: 'access-token',
  refreshToken: REFRESH_TOKEN,
  expiresIn: 900,
  user: {
    id: USER_ID,
    email: 'user@example.com',
    role: 'USER',
  },
};

type RouteName = 'signup' | 'login' | 'refresh' | 'logout' | 'withdraw';
type CallCounts = Record<RouteName, number>;

test.each([
  {
    name: 'same-origin',
    options: createAuthOptions({ NODE_ENV: 'test', JWT_SECRET: SECRET }),
    origin: 'http://localhost:3000',
    protocol: 'http',
    host: 'localhost:3000',
  },
  {
    name: 'allowlisted cross-origin',
    options: createAuthOptions({
      NODE_ENV: 'test',
      JWT_SECRET: SECRET,
      AUTH_ALLOWED_ORIGINS: 'https://app.example.com',
    }),
    origin: 'https://app.example.com',
    protocol: 'https',
    host: 'api.example.com',
  },
])('$name Origin은 다섯 auth route의 기존 side effect를 허용한다', async (scenario) => {
  const { controller, calls } = createController(scenario.options);

  const signupResponse = createResponse();
  await controller.signup(
    {} as never,
    {} as never,
    createRequest(scenario.origin, scenario.protocol, scenario.host),
    signupResponse.response,
  );
  assert.equal(calls.signup, 1);
  assert.match(String(signupResponse.headers['Set-Cookie']), /^newtine_refresh=/);

  const loginResponse = createResponse();
  await controller.login(
    {} as never,
    {} as never,
    createRequest(scenario.origin, scenario.protocol, scenario.host),
    loginResponse.response,
  );
  assert.equal(calls.login, 1);
  assert.match(String(loginResponse.headers['Set-Cookie']), /^newtine_refresh=/);

  const refreshResponse = createResponse();
  await controller.refresh(
    {} as never,
    createRequest(scenario.origin, scenario.protocol, scenario.host, true),
    refreshResponse.response,
  );
  assert.equal(calls.refresh, 1);
  assert.match(String(refreshResponse.headers['Set-Cookie']), /^newtine_refresh=/);

  const logoutResponse = createResponse();
  await controller.logout(
    {},
    createRequest(scenario.origin, scenario.protocol, scenario.host, true),
    logoutResponse.response,
  );
  assert.equal(calls.logout, 1);
  assert.match(String(logoutResponse.headers['Set-Cookie']), /Max-Age=0/);

  const withdrawResponse = createResponse();
  await controller.withdraw(
    {},
    createRequest(scenario.origin, scenario.protocol, scenario.host, true),
    { userId: USER_ID, role: 'USER' },
    withdrawResponse.response,
  );
  assert.equal(calls.withdraw, 1);
  assert.match(String(withdrawResponse.headers['Set-Cookie']), /Max-Age=0/);
});

test.each([
  { name: 'missing', origin: undefined },
  { name: 'disallowed', origin: 'https://evil.example' },
])('$name Origin은 다섯 auth route의 use case와 cookie effect를 차단한다', async ({ origin }) => {
  const options = createAuthOptions({
    NODE_ENV: 'test',
    JWT_SECRET: SECRET,
    AUTH_ALLOWED_ORIGINS: 'https://app.example.com',
  });
  const { controller, calls } = createController(options);

  await assertRejectedWithoutSideEffect((response) =>
    controller.signup(
      {} as never,
      {} as never,
      createRequest(origin, 'https', 'api.example.com'),
      response,
    ),
  );
  await assertRejectedWithoutSideEffect((response) =>
    controller.login(
      {} as never,
      {} as never,
      createRequest(origin, 'https', 'api.example.com'),
      response,
    ),
  );
  await assertRejectedWithoutSideEffect((response) =>
    controller.refresh({}, createRequest(origin, 'https', 'api.example.com', true), response),
  );
  await assertRejectedWithoutSideEffect((response) =>
    controller.logout({}, createRequest(origin, 'https', 'api.example.com', true), response),
  );
  await assertRejectedWithoutSideEffect((response) =>
    controller.withdraw(
      {},
      createRequest(origin, 'https', 'api.example.com', true),
      { userId: USER_ID, role: 'USER' },
      response,
    ),
  );

  assert.deepEqual(calls, {
    signup: 0,
    login: 0,
    refresh: 0,
    logout: 0,
    withdraw: 0,
  });
});

function createController(options: AuthOptions): {
  controller: AuthController;
  calls: CallCounts;
} {
  const calls: CallCounts = {
    signup: 0,
    login: 0,
    refresh: 0,
    logout: 0,
    withdraw: 0,
  };
  const useCase = (name: RouteName, result: unknown) => ({
    execute: async () => {
      calls[name] += 1;
      return result;
    },
  });

  return {
    controller: new AuthControllerClass(
      useCase('signup', SESSION) as never,
      useCase('login', SESSION) as never,
      useCase('refresh', SESSION) as never,
      useCase('logout', undefined) as never,
      useCase('withdraw', undefined) as never,
      options,
    ),
    calls,
  };
}

function createRequest(
  origin: string | undefined,
  protocol: string,
  host: string,
  withRefreshCookie = false,
): never {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.origin = origin;
  if (withRefreshCookie) headers.cookie = `newtine_refresh=${REFRESH_TOKEN}`;
  return {
    headers,
    protocol,
    get: () => host,
    body: undefined,
    query: {},
  } as never;
}

function createResponse(): { response: never; headers: Record<string, unknown> } {
  const headers: Record<string, unknown> = {};
  return {
    headers,
    response: {
      setHeader(name: string, value: unknown) {
        headers[name] = value;
      },
    } as never,
  };
}

async function assertRejectedWithoutSideEffect(
  invoke: (response: never) => Promise<unknown>,
): Promise<void> {
  const output = createResponse();
  await assert.rejects(invoke(output.response), (error: unknown) => {
    return error instanceof ForbiddenException;
  });
  assert.deepEqual(output.headers, {});
}
