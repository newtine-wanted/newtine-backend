import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from '@jest/globals';

import type { PinoLogger } from 'nestjs-pino';

import {
  HttpRequestContextMiddleware,
  type HttpRequestContext,
} from '@newtine/api/common/middleware/httpRequestContext.middleware.js';

class TestResponse extends EventEmitter {
  statusCode = 200;
  writableFinished = false;
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }
}

function createLogger(warnings: unknown[][]): PinoLogger {
  return {
    logger: { bindings: () => ({ requestId: 'request-1' }) },
    setContext: () => undefined,
    warn: (...args: unknown[]) => warnings.push(args),
  } as unknown as PinoLogger;
}

test('HttpRequestContextMiddleware reuses the Pino request id and logs only slow successful responses', () => {
  const warnings: unknown[][] = [];
  let now = 1_000_000_000n;
  const middleware = new HttpRequestContextMiddleware(createLogger(warnings), 1, () => now);
  const request = {
    id: 'request-1',
    method: 'GET',
    path: '/health',
  } as unknown as HttpRequestContext;
  const response = new TestResponse();

  middleware.use(request, response as never, () => undefined);
  now += 1_500_000n;
  response.emit('finish');

  assert.equal(request.requestId, 'request-1');
  assert.equal(response.headers.get('x-request-id'), 'request-1');
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0], [
    {
      event: 'http.slow',
      method: 'GET',
      path: '/health',
      status: 200,
      durationMs: 1.5,
    },
    'Slow HTTP request',
  ]);
});

test('HttpRequestContextMiddleware does not duplicate filter diagnostics on an aborted response', () => {
  const warnings: unknown[][] = [];
  let now = 1_000_000_000n;
  const middleware = new HttpRequestContextMiddleware(createLogger(warnings), 1, () => now);
  const request = {
    id: 'request-1',
    method: 'POST',
    path: '/issues/search',
    httpExceptionLogged: true,
  } as unknown as HttpRequestContext;
  const response = new TestResponse();

  middleware.use(request, response as never, () => undefined);
  now += 2_000_000n;
  response.emit('close');

  assert.equal(warnings.length, 0);
});
