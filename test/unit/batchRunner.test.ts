import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { PinoLogger } from 'nestjs-pino';

import { BatchRunner } from '@newtine/batch/runner/batch.runner.js';

function createLogger(): PinoLogger {
  return {
    info: () => undefined,
    error: () => undefined,
    setContext: () => undefined,
    runInContext: (callback: () => unknown) => callback(),
  } as unknown as PinoLogger;
}

test('BatchRunner rejects an unknown job without running a job', async () => {
  let called = false;
  const runner = new BatchRunner(
    {
      run: async () => {
        called = true;
      },
    } as never,
    createLogger(),
  );

  assert.equal(await runner.run('unknown'), 1);
  assert.equal(called, false);
});

test('BatchRunner returns zero after a successful database check', async () => {
  const runner = new BatchRunner({ run: async () => undefined } as never, createLogger());

  assert.equal(await runner.run('databaseCheck'), 0);
});

test('BatchRunner converts a job failure to exit code one', async () => {
  const runner = new BatchRunner(
    {
      run: async () => {
        throw new Error('database unavailable');
      },
    } as never,
    createLogger(),
  );

  assert.equal(await runner.run('databaseCheck'), 1);
});
