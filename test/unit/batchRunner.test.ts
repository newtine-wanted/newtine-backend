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

test('알 수 없는 작업은 실행하지 않고 종료 코드 1을 반환한다', async () => {
  let called = false;
  const runner = new BatchRunner(
    {
      run: async () => {
        called = true;
      },
    } as never,
    createLogger(),
    'databaseCheck',
  );

  assert.equal(await runner.run('unknown'), 1);
  assert.equal(called, false);
});

test('선택한 작업이 성공하면 종료 코드 0을 반환한다', async () => {
  const runner = new BatchRunner(
    { run: async () => undefined } as never,
    createLogger(),
    'databaseCheck',
  );

  assert.equal(await runner.run('databaseCheck'), 0);
});

test('작업 실패를 종료 코드 1로 변환한다', async () => {
  const runner = new BatchRunner(
    {
      run: async () => {
        throw new Error('database unavailable');
      },
    } as never,
    createLogger(),
    'databaseCheck',
  );

  assert.equal(await runner.run('databaseCheck'), 1);
});

test('파이프라인 작업에는 실행 ID와 별도의 프로세스 실행 ID를 전달한다', async () => {
  let processExecutionId: string | undefined;
  const runner = new BatchRunner(
    {
      run: async (value: string) => {
        processExecutionId = value;
      },
    } as never,
    createLogger(),
    'pipelineWorker',
  );

  assert.equal(await runner.run('pipelineWorker'), 0);
  assert.ok(processExecutionId);
  assert.equal(isUuidV7(processExecutionId), true);
});

test('임베딩 복구에 종료 신호를 전달한다', async () => {
  let receivedSignal: AbortSignal | undefined;
  const runner = new BatchRunner(
    {
      run: async (_processExecutionId: string, signal?: AbortSignal) => {
        receivedSignal = signal;
      },
    } as never,
    createLogger(),
    'pipelineEmbeddingRepair',
  );
  const controller = new AbortController();

  assert.equal(await runner.run('pipelineEmbeddingRepair', controller.signal), 0);
  assert.equal(receivedSignal, controller.signal);
});

test('리포트 워커에 프로세스 소유자와 종료 신호를 전달한다', async () => {
  let owner: string | undefined;
  let receivedSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const runner = new BatchRunner(
    {
      run: async (value: string, signal?: AbortSignal) => {
        owner = value;
        receivedSignal = signal;
      },
    } as never,
    createLogger(),
    'reportWorker',
  );
  assert.equal(await runner.run('reportWorker', controller.signal), 0);
  assert.ok(owner && isUuidV7(owner));
  assert.equal(receivedSignal, controller.signal);
});
