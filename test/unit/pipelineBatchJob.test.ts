import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { generateUuidV7 } from '@newtine/core';
import { PipelineBatchJob } from '@newtine/batch/pipeline/pipeline.batch.job.js';

test('pipeline batch job forwards the shutdown signal to the long-running worker', async () => {
  const previousOnce = process.env.PIPELINE_WORKER_ONCE;
  delete process.env.PIPELINE_WORKER_ONCE;
  try {
    let receivedPollInterval: number | undefined;
    let receivedSignal: AbortSignal | undefined;
    let receivedProcessExecutionId: ReturnType<typeof generateUuidV7> | undefined;
    const worker = {
      runOnce: async () => false,
      runForever: async (
        pollIntervalMs: number,
        signal?: AbortSignal,
        processExecutionId?: ReturnType<typeof generateUuidV7>,
      ) => {
        receivedPollInterval = pollIntervalMs;
        receivedSignal = signal;
        receivedProcessExecutionId = processExecutionId;
      },
    };
    const job = new PipelineBatchJob(worker as never);
    const controller = new AbortController();
    const processExecutionId = generateUuidV7();

    await job.run(processExecutionId, controller.signal);

    assert.equal(receivedPollInterval, 1_000);
    assert.equal(receivedSignal, controller.signal);
    assert.equal(receivedProcessExecutionId, processExecutionId);
  } finally {
    if (previousOnce === undefined) delete process.env.PIPELINE_WORKER_ONCE;
    else process.env.PIPELINE_WORKER_ONCE = previousOnce;
  }
});

test('pipeline batch job does not start a worker after shutdown was requested', async () => {
  const previousOnce = process.env.PIPELINE_WORKER_ONCE;
  delete process.env.PIPELINE_WORKER_ONCE;
  try {
    let started = false;
    const worker = {
      runOnce: async () => false,
      runForever: async () => {
        started = true;
      },
    };
    const job = new PipelineBatchJob(worker as never);
    const controller = new AbortController();
    controller.abort();

    await job.run(generateUuidV7(), controller.signal);

    assert.equal(started, false);
  } finally {
    if (previousOnce === undefined) delete process.env.PIPELINE_WORKER_ONCE;
    else process.env.PIPELINE_WORKER_ONCE = previousOnce;
  }
});
