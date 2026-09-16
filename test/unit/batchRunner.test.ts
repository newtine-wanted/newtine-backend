import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { PinoLogger } from 'nestjs-pino';

import { isUuidV7 } from '@newtine/core';
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

test('BatchRunner gives pipeline jobs a process execution id separate from the run id', async () => {
  let processExecutionId: string | undefined;
  const runner = new BatchRunner({ run: async () => undefined } as never, createLogger(), {
    run: async (value: string) => {
      processExecutionId = value;
    },
  } as never);

  assert.equal(await runner.run('pipelineWorker'), 0);
  assert.ok(processExecutionId);
  assert.equal(isUuidV7(processExecutionId), true);
});

test('BatchRunner forwards the shutdown signal to embedding repair', async () => {
  let receivedSignal: AbortSignal | undefined;
  const runner = new BatchRunner(
    { run: async () => undefined } as never,
    createLogger(),
    undefined,
    {
      run: async (
        _processExecutionId: string,
        _reclaimProcessExecutionId: string,
        signal?: AbortSignal,
      ) => {
        receivedSignal = signal;
      },
    } as never,
  );
  const controller = new AbortController();

  assert.equal(await runner.run('pipelineEmbeddingRepair', controller.signal), 0);
  assert.equal(receivedSignal, controller.signal);
});

test('BatchRunner forwards the process owner and shutdown signal to report worker', async () => {
  let owner: string | undefined;
  let receivedSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const runner = new BatchRunner(
    { run: async () => undefined } as never,
    createLogger(),
    undefined,
    undefined,
    {
      run: async (value: string, signal?: AbortSignal) => {
        owner = value;
        receivedSignal = signal;
      },
    } as never,
  );
  assert.equal(await runner.run('reportWorker', controller.signal), 0);
  assert.ok(owner && isUuidV7(owner));
  assert.equal(receivedSignal, controller.signal);
});
