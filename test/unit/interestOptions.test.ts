import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  createInterestOptions,
  InterestConfigurationException,
} from '@newtine/api/interest/interest.options.js';

test('interest options default to the Figma seven-day window and low-sample threshold', () => {
  assert.deepEqual(createInterestOptions({}), {
    analysisWindowDays: 7,
    minimumSampleSize: 10,
  });
});

test('interest options reject invalid server configuration', () => {
  const invalidConfigurations: Array<[string, string]> = [
    ['INTEREST_ANALYSIS_WINDOW_DAYS', '0'],
    ['INTEREST_ANALYSIS_WINDOW_DAYS', '1.5'],
    ['INTEREST_ANALYSIS_WINDOW_DAYS', '366'],
    ['INTEREST_ANALYSIS_MINIMUM_SAMPLE_SIZE', '0'],
    ['INTEREST_ANALYSIS_MINIMUM_SAMPLE_SIZE', '100001'],
    ['INTEREST_ANALYSIS_MINIMUM_SAMPLE_SIZE', 'NaN'],
  ];
  for (const [key, value] of invalidConfigurations) {
    const env: NodeJS.ProcessEnv = {};
    env[key] = value;
    assert.throws(
      () => createInterestOptions(env),
      (exception: unknown) => exception instanceof InterestConfigurationException,
    );
  }
});
