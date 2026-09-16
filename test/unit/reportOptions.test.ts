import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  DEFAULT_REPORT_AI_TIMEOUT_MS,
  DEFAULT_REPORT_WORKER_EXECUTION_TIMEOUT_MS,
  DEFAULT_REPORT_WORKER_HEARTBEAT_MS,
  DEFAULT_REPORT_WORKER_LEASE_MS,
  DEFAULT_REPORT_WORKER_POLL_MS,
  ReportAiConfiguration,
  resolveReportWorkerOptions,
} from '@newtine/batch/report/report.ai.config.js';

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    REPORT_AI_MODEL: 'test-report-model',
    OPENAI_API_KEY: 'test-key',
    ...overrides,
  };
}

test('report AI configuration has isolated worker defaults and immutable prompt metadata', () => {
  const configuration = new ReportAiConfiguration(env());

  assert.equal(configuration.model, 'test-report-model');
  assert.equal(configuration.providerTimeoutMs, DEFAULT_REPORT_AI_TIMEOUT_MS);
  assert.deepEqual(configuration.worker, {
    pollIntervalMs: DEFAULT_REPORT_WORKER_POLL_MS,
    leaseMs: DEFAULT_REPORT_WORKER_LEASE_MS,
    heartbeatMs: DEFAULT_REPORT_WORKER_HEARTBEAT_MS,
    providerTimeoutMs: DEFAULT_REPORT_AI_TIMEOUT_MS,
    executionTimeoutMs: DEFAULT_REPORT_WORKER_EXECUTION_TIMEOUT_MS,
    concurrency: 1,
  });
  assert.equal(Object.isFrozen(configuration.snapshot), true);
  assert.match(configuration.generationPrompt.hash, /^[0-9a-f]{64}$/);
  assert.match(configuration.validationPrompt.hash, /^[0-9a-f]{64}$/);
});

test('report configuration does not require the API key until reportWorker is selected', () => {
  const configuration = new ReportAiConfiguration(env({ OPENAI_API_KEY: undefined }));

  assert.throws(() => configuration.assertReady(), /OPENAI_API_KEY/);
});

test('report configuration rejects invalid timing and concurrency settings', () => {
  assert.throws(
    () => resolveReportWorkerOptions(env({ REPORT_AI_TIMEOUT_MS: '999' })),
    /REPORT_AI_TIMEOUT_MS/,
  );
  assert.throws(
    () => resolveReportWorkerOptions(env({ REPORT_WORKER_HEARTBEAT_MS: '180000' })),
    /REPORT_WORKER_HEARTBEAT_MS/,
  );
  assert.throws(
    () => resolveReportWorkerOptions(env({ REPORT_WORKER_CONCURRENCY: '2' })),
    /REPORT_WORKER_CONCURRENCY/,
  );
  assert.throws(
    () => resolveReportWorkerOptions(env({ REPORT_WORKER_EXECUTION_TIMEOUT_MS: '1000' })),
    /REPORT_WORKER_EXECUTION_TIMEOUT_MS/,
  );
});
