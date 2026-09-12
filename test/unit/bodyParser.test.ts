import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { bodyParserExceptionMiddleware } from '@newtine/api/common/middleware/bodyParser.middleware.js';

test('body parser exceptions normalize to safe 400/413 responses', () => {
  for (const [type, status] of [
    ['entity.parse.failed', 400],
    ['entity.too.large', 413],
  ] as const) {
    const input = Object.assign(new Error('private parser sentinel'), {
      type,
      status,
      body: 'secret',
    });
    let result: unknown;
    bodyParserExceptionMiddleware(input, {} as Request, {} as Response, (exception: unknown) => {
      result = exception;
    });
    assert.ok(result instanceof HttpException);
    assert.equal(result.getStatus(), status);
    assert.doesNotMatch(JSON.stringify(result.getResponse()), /private|secret/);
  }
});

test('unknown parser errors and mismatched statuses are forwarded unchanged', () => {
  for (const input of [
    new Error('unknown'),
    { type: 'entity.too.large', status: 413 },
    Object.assign(new Error('wrong status'), { type: 'entity.too.large', status: 500 }),
  ]) {
    let result: unknown;
    bodyParserExceptionMiddleware(input, {} as Request, {} as Response, (exception: unknown) => {
      result = exception;
    });
    assert.equal(result, input);
  }
});
