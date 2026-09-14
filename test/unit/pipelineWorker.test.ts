import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from '@jest/globals';

import { PipelineWorker } from '@newtine/batch/pipeline/pipeline.worker.js';

function logger() {
  return {
    setContext: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as never;
}

test('PipelineWorker removes idle wait listeners after each timer cycle', async () => {
  const controller = new AbortController();
  let claimCount = 0;
  const worker = new PipelineWorker(
    {
      claimNext: async () => {
        claimCount += 1;
        return null;
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    logger(),
  );
  const running = worker.runForever(1, controller.signal);

  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(claimCount > 1);
    assert.ok(getEventListeners(controller.signal, 'abort').length <= 1);
  } finally {
    controller.abort();
    await running;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});
