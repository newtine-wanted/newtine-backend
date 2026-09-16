import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import { toApiException } from '@newtine/api/common/exception/domainException.mapper.js';
import { ReportException } from '@newtine/core/report/report.exception.js';

test('report input limits map to the documented 429 response', () => {
  const mapped = toApiException(new ReportException('INPUT_LIMIT_EXCEEDED'));

  assert.equal(mapped, ApiException.ReportInputLimit);
  assert.equal(mapped.status, 429);
  assert.equal(mapped.title, 'Too Many Requests');
});
