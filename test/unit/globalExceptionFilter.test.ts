import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import type { PinoLogger } from 'nestjs-pino';
import { BadRequestException, HttpException, InternalServerErrorException } from '@nestjs/common';

import { DomainException, IssueException, IssueExceptionCode } from '@newtine/core';
import { GlobalExceptionFilter } from '@newtine/api/common/filter/globalExceptionFilter.js';

class TestDomainException extends DomainException<string> {
  readonly domain = 'test';

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
  }
}

type LogEntry = {
  level: 'warn' | 'error';
  args: unknown[];
};

function createFilter(entries: LogEntry[] = []): GlobalExceptionFilter {
  return new GlobalExceptionFilter({
    logger: { bindings: () => ({}) },
    setContext: () => undefined,
    warn: (...args: unknown[]) => entries.push({ level: 'warn', args }),
    error: (...args: unknown[]) => entries.push({ level: 'error', args }),
  } as unknown as PinoLogger);
}

function createHost(requestOverrides: Record<string, unknown> = {}) {
  const state: { status?: number; type?: string; body?: unknown } = {};
  const response = {
    status(status: number) {
      state.status = status;
      return this;
    },
    type(type: string) {
      state.type = type;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };

  return {
    state,
    host: {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'GET',
          url: '/health',
          path: '/health',
          requestId: 'request-1',
          ...requestOverrides,
        }),
      }),
    },
  };
}

test('GlobalExceptionFilter maps a domain exception and logs its domain identity', () => {
  const logs: LogEntry[] = [];
  const filter = createFilter(logs);
  const { state, host } = createHost();

  filter.catch(
    new IssueException(IssueExceptionCode.NotFound, '이슈를 찾을 수 없습니다.'),
    host as never,
  );

  assert.equal(state.status, 404);
  assert.equal(state.type, 'application/problem+json');
  assert.deepEqual(state.body, {
    title: 'Not Found',
    status: 404,
    detail: '이슈를 찾을 수 없습니다.',
    code: 'NOT_FOUND',
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.level, 'warn');
  const log = JSON.stringify(logs[0]?.args[0]);
  assert.match(log, /"exceptionName":"IssueException"/);
  assert.match(log, /"domain":"issue"/);
  assert.match(log, /"domainCode":"ISSUE_NOT_FOUND"/);
});

test('GlobalExceptionFilter hides unexpected exception details', () => {
  const filter = createFilter();
  const { state, host } = createHost();

  filter.catch(new Error('secret database detail'), host as never);

  assert.deepEqual(state.body, {
    title: 'Internal Server Error',
    status: 500,
    detail: '요청 처리 중 오류가 발생했습니다.',
    code: 'INTERNAL_ERROR',
  });
});

test('GlobalExceptionFilter hides internal HttpException payloads', () => {
  const filter = createFilter();
  const { state, host } = createHost();

  filter.catch(
    new InternalServerErrorException({
      message: ['secret database detail'],
      errors: [{ path: '$input.password', value: 'secret' }],
    }),
    host as never,
  );

  assert.deepEqual(state.body, {
    title: 'Internal Server Error',
    status: 500,
    detail: '요청 처리 중 오류가 발생했습니다.',
    code: 'INTERNAL_ERROR',
  });
});

test('GlobalExceptionFilter keeps validation failures within the four-field contract', () => {
  const filter = createFilter();
  const { state, host } = createHost();

  filter.catch(
    new BadRequestException({
      message: 'Request body data is not following the promised type.',
      errors: [
        {
          path: '$input.query',
          expected: 'string & MinLength<1>',
          value: '',
        },
      ],
    }),
    host as never,
  );

  assert.deepEqual(state.body, {
    title: 'Bad Request',
    status: 400,
    detail: '요청 값이 올바르지 않습니다.',
    code: 'INVALID_ARGUMENT',
  });
});

test('GlobalExceptionFilter uses the standard title for an otherwise unlisted HTTP status', () => {
  const filter = createFilter();
  const { state, host } = createHost();

  filter.catch(new HttpException('teapot detail', 418), host as never);

  assert.deepEqual(state.body, {
    title: "I'm a Teapot",
    status: 418,
    detail: '요청을 처리할 수 없습니다.',
    code: 'HTTP_418',
  });
});

test('GlobalExceptionFilter keeps query values out of exception paths and details', () => {
  const logs: LogEntry[] = [];
  const { state, host } = createHost({
    url: '/missing?token=query-secret',
    path: '/missing',
  });

  createFilter(logs).catch(
    new HttpException('Cannot GET /missing?token=query-secret', 404),
    host as never,
  );

  assert.equal(
    state.body && typeof state.body === 'object'
      ? (state.body as { detail: string }).detail
      : undefined,
    '요청한 리소스를 찾을 수 없습니다.',
  );
  assert.doesNotMatch(JSON.stringify(state.body), /query-secret/);
  const log = logs[0]?.args[0] as { path?: string };
  assert.equal(log.path, '/missing');
  assert.doesNotMatch(JSON.stringify(logs[0]?.args[0]), /query-secret/);
});

test('unregistered and prototype domain codes normalize to INTERNAL_ERROR', () => {
  for (const code of ['NEW_BUSINESS_CODE', 'toString', 'constructor', '__proto__']) {
    const { state, host } = createHost();
    createFilter().catch(new TestDomainException(code, 'internal sentinel'), host as never);
    assert.deepEqual(state.body, {
      title: 'Internal Server Error',
      status: 500,
      detail: '요청 처리 중 오류가 발생했습니다.',
      code: 'INTERNAL_ERROR',
    });
  }
});

test('5xx logs omit exception messages and response payloads', () => {
  const logs: LogEntry[] = [];
  const exception = new InternalServerErrorException(
    { errors: [{ value: 'private-response-sentinel' }] },
    { cause: new Error('database diagnostic sentinel') },
  );
  const { state, host } = createHost();
  createFilter(logs).catch(exception, host as never);
  const serialized = JSON.stringify(logs[0]?.args);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.level, 'error');
  assert.match(serialized, /request-1/);
  assert.match(serialized, /InternalServerErrorException/);
  assert.doesNotMatch(serialized, /database diagnostic sentinel|private-response-sentinel/);
  assert.doesNotMatch(JSON.stringify(state.body), /sentinel|stack|cause/);
});

test('domain 5xx errors use error-level diagnostics and cyclic causes cannot break the filter', () => {
  const logs: LogEntry[] = [];
  const exception = new TestDomainException('TEST_INTERNAL_ERROR', 'domain diagnostic sentinel');
  exception.cause = exception;
  const { state, host } = createHost();
  createFilter(logs).catch(exception, host as never);
  assert.equal(state.status, 500);
  assert.equal(logs[0]?.level, 'error');
  assert.match(JSON.stringify(logs), /TestDomainException/);
  assert.match(JSON.stringify(logs), /causeTruncated/);
});

test('an arbitrary object status is not trusted as an HTTP status', () => {
  const { state, host } = createHost();
  createFilter().catch({ status: 413, body: 'private sentinel' }, host as never);
  assert.equal(state.status, 500);
  assert.doesNotMatch(JSON.stringify(state.body), /private sentinel/);
});

test('an invalid HttpException status is normalized before writing the response', () => {
  const { state, host } = createHost();
  createFilter().catch(new HttpException('private sentinel', 9_999), host as never);

  assert.equal(state.status, 500);
  assert.deepEqual(state.body, {
    title: 'Internal Server Error',
    status: 500,
    detail: '요청 처리 중 오류가 발생했습니다.',
    code: 'INTERNAL_ERROR',
  });
});
