import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { generateUuidV7 } from '@newtine/core';
import { ReportService } from '@newtine/api/report/report.service.js';
import { ReportException } from '@newtine/core/report/report.exception.js';
import {
  eligibleReportPeriod,
  recentReportPeriods,
  reportPeriod,
} from '@newtine/core/report/report.period.js';
import type {
  ReportContent,
  ReportRecord,
  ReportRepository,
} from '@newtine/core/report/report.model.js';

const now = new Date('2026-09-16T02:00:00.000Z');
const owner = generateUuidV7();
function record(): ReportRecord {
  return {
    id: generateUuidV7(),
    userId: owner,
    period: eligibleReportPeriod(now),
    status: 'QUEUED',
    input: {
      version: 1,
      capturedAt: now.toISOString(),
      issues: [],
      categoryCounts: [],
      excludedCount: 0,
      hash: 'fixture',
    },
    candidates: null,
    content: null,
    attempt: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    requestedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    startedAt: null,
    completedAt: null,
    nextAttemptAt: now.toISOString(),
    lastErrorCode: null,
    retryable: false,
  };
}
function repo(methods: Partial<ReportRepository>): ReportRepository {
  return methods as ReportRepository;
}

test('KST Monday boundary changes completed week and keeps exclusive end', () => {
  assert.equal(eligibleReportPeriod(new Date('2026-09-13T14:59:59.999Z')).start, '2026-08-31');
  const current = eligibleReportPeriod(new Date('2026-09-13T15:00:00.000Z'));
  assert.deepEqual(current, {
    start: '2026-09-07',
    end: '2026-09-14',
    startAt: '2026-09-06T15:00:00.000Z',
    endAt: '2026-09-13T15:00:00.000Z',
  });
  assert.equal(recentReportPeriods(now).length, 4);
  for (const invalid of ['2026-02-30', '2026-09-08', '2026-9-7', 'foo'])
    assert.throws(() => reportPeriod(invalid), ReportException);
});

test('request accepts only latest completed week and returns no input or owner fields', async () => {
  let calls = 0;
  const stored = record();
  const service = new ReportService(
    repo({
      request: async (user, period) => {
        calls++;
        assert.equal(user, owner);
        assert.equal(period.start, '2026-09-07');
        return stored;
      },
    }),
  );
  const response = await service.request(owner, '2026-09-07', now);
  assert.equal(response.reportId, stored.id);
  assert.equal(Object.hasOwn(response, 'input'), false);
  assert.equal(Object.hasOwn(response, 'userId'), false);
  assert.equal(Object.hasOwn(response, 'leaseToken'), false);
  await assert.rejects(service.request(owner, '2026-09-14', now), { code: 'INVALID_PERIOD' });
  await assert.rejects(service.request(owner, '2026-08-31', now), { code: 'INVALID_PERIOD' });
  assert.equal(calls, 1);
});

test('GET list has four calendar slots and never enqueues missing reports', async () => {
  const stored = record();
  stored.status = 'SUCCEEDED';
  const service = new ReportService(
    repo({
      findLatestSucceeded: async () => stored,
      listOwned: async (user, oldest) => {
        assert.equal(user, owner);
        assert.equal(oldest, '2026-08-17');
        return [stored];
      },
    }),
  );
  const response = await service.list(owner, now);
  assert.equal(response.periods.filter((p) => p.report === null).length, 3);
  assert.equal(response.latestSucceeded?.reportId, stored.id);
  assert.equal(response.nextEligibleAt, '2026-09-20T15:00:00.000Z');
});

test('foreign/missing report is indistinguishable and never requests visibility', async () => {
  const foreign = generateUuidV7();
  const service = new ReportService(
    repo({
      findOwned: async (user, id) => {
        assert.equal(user, owner);
        assert.equal(id, foreign);
        return null;
      },
      visibility: async () => {
        throw new Error('must not inspect foreign content');
      },
    }),
  );
  await assert.rejects(service.get(owner, foreign, now), { code: 'NOT_FOUND' });
});

test('withdrawn evidence hides whole connection and referenced recommendation, while original statistics stay fixed', async () => {
  const first = generateUuidV7(),
    withdrawn = generateUuidV7(),
    related = generateUuidV7(),
    major = generateUuidV7();
  const issue = (id: typeof first) => ({
    issueId: id,
    title: 'fixture',
    categoryCode: 'housing',
    categoryName: '주거',
    categoryOrder: 1,
    summary: 'summary',
    summaryLines: ['a', 'b', 'c'],
  });
  const content: ReportContent = {
    schemaVersion: 1,
    analysisStatus: 'READY',
    issueCount: 5,
    minimumIssueCount: 5,
    categoryCounts: [{ categoryCode: 'housing', displayName: '주거', count: 5 }],
    connections: [
      {
        label: '주거',
        title: '연결',
        description: '공통점. 차이점.',
        issueIds: [first, withdrawn],
      },
    ],
    evidenceIssues: [issue(first), issue(withdrawn)],
    relatedIssues: [{ ...issue(related), sourceIssueId: withdrawn, reason: '관련' }],
    majorIssues: [issue(major)],
    majorIssueCategoryCodes: ['housing'],
    majorIssuesStatus: 'READY',
    recommendationsStatus: 'READY',
    recommendationCapturedAt: now.toISOString(),
  };
  const stored = { ...record(), status: 'SUCCEEDED' as const, content };
  const service = new ReportService(
    repo({
      findOwned: async () => stored,
      visibility: async () => ({ publicIssueIds: [first, related, major], actedIssueIds: [major] }),
    }),
  );
  const result = await service.get(owner, stored.id, now);
  assert.equal(result.contentAvailability, 'PARTIAL');
  assert.deepEqual(result.content?.connections, []);
  assert.deepEqual(result.content?.relatedIssues, []);
  assert.deepEqual(result.content?.majorIssues, []);
  assert.equal(result.content?.evidenceIssues.length, 1);
  assert.equal(result.content?.issueCount, 5);
  assert.equal(
    stored.content.connections.length,
    1,
    'stored successful snapshot is never mutated by GET',
  );
});

test('unfinished report never exposes provisional content; expired retry no longer advertised', async () => {
  const stored = record();
  stored.status = 'FAILED';
  stored.retryable = true;
  stored.attempt = 3;
  stored.period = reportPeriod('2026-08-10');
  stored.lastErrorCode = 'UPSTREAM_ERROR';
  const service = new ReportService(repo({ findOwned: async () => stored }));
  const result = await service.get(owner, stored.id, now);
  assert.equal(result.content, null);
  assert.equal(result.contentAvailability, 'UNAVAILABLE');
  assert.equal(result.retryable, false);
  assert.equal(result.nextRetryAt, null);
});

test('last successful report remains available beyond the four-week selector window', async () => {
  const previous = {
    ...record(),
    status: 'SUCCEEDED' as const,
    period: reportPeriod('2026-08-03'),
  };
  const service = new ReportService(
    repo({ listOwned: async () => [], findLatestSucceeded: async () => previous }),
  );
  const response = await service.list(owner, now);
  assert.ok(response.periods.every((p) => p.report === null));
  assert.equal(response.latestSucceeded?.period.start, '2026-08-03');
});
