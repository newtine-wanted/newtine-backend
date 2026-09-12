import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  createLoggerOptions,
  DEFAULT_HTTP_SLOW_THRESHOLD_MS,
  isUuidV7,
  LoggingConfigurationException,
  resolveHttpSlowThreshold,
  resolveLogLevel,
} from '@newtine/core';

test('logging configuration uses safe defaults and validates values', () => {
  assert.equal(resolveLogLevel(undefined, 'production'), 'info');
  assert.equal(resolveLogLevel(undefined, 'development'), 'debug');
  assert.equal(resolveLogLevel('warn', 'production'), 'warn');
  assert.equal(resolveHttpSlowThreshold(), DEFAULT_HTTP_SLOW_THRESHOLD_MS);
  assert.equal(resolveHttpSlowThreshold('250'), 250);

  const options = createLoggerOptions('api');
  const pinoHttp = options.pinoHttp as { genReqId?: (request: unknown) => string };
  const requestId = pinoHttp.genReqId?.({ requestId: 'client-value' });
  assert.equal(typeof requestId, 'string');
  assert.equal(isUuidV7(String(requestId)), true);
  assert.notEqual(requestId, 'client-value');
});

test('logging configuration rejects invalid level and slow threshold', () => {
  assert.throws(
    () => resolveLogLevel('verbose', 'production'),
    (exception: unknown) => exception instanceof LoggingConfigurationException,
  );
  assert.throws(
    () => resolveHttpSlowThreshold('0'),
    (exception: unknown) => exception instanceof LoggingConfigurationException,
  );
  assert.throws(
    () => resolveHttpSlowThreshold('1.5'),
    (exception: unknown) => exception instanceof LoggingConfigurationException,
  );
});
