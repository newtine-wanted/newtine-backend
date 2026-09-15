import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { generateUuidV7, type InterestRepository } from '@newtine/core';
import { InterestService } from '@newtine/api/interest/interest.service.js';
import type { InterestOptions } from '@newtine/api/interest/interest.options.js';
import { encodeInterestCursor } from '@newtine/api/interest/type/interest.cursor.js';

function createRepository(issueCount: number): {
  repository: InterestRepository;
  periods: Array<{ startAt: Date; endAt: Date }>;
  queries: Array<{ limit: number; categoryCode?: string; cursor?: unknown }>;
} {
  const periods: Array<{ startAt: Date; endAt: Date }> = [];
  const queries: Array<{ limit: number; categoryCode?: string; cursor?: unknown }> = [];
  const repository: InterestRepository = {
    async getInterestAnalysis(_userId, period) {
      periods.push(period);
      return { issueCount, likedIssueCount: issueCount, categoryCounts: [] };
    },
    async getLikedIssues(_userId, query) {
      queries.push(query);
      return { items: [], totalCount: 0, nextCursor: null };
    },
  };
  return { repository, periods, queries };
}

test('interest service applies the configured seven-day period and sample status', async () => {
  for (const [issueCount, sampleStatus] of [
    [0, 'EMPTY'],
    [9, 'LOW_SAMPLE'],
    [10, 'READY'],
  ] as const) {
    const { repository, periods } = createRepository(issueCount);
    const options: InterestOptions = { analysisWindowDays: 7, minimumSampleSize: 10 };
    const service = new InterestService(repository, options);

    const result = await service.getInterestAnalysis(generateUuidV7());

    assert.equal(result.sampleStatus, sampleStatus);
    assert.equal(result.period.days, 7);
    assert.equal(periods.length, 1);
    assert.equal(periods[0]!.endAt.getTime(), result.asOf.getTime());
    assert.equal(periods[0]!.endAt.getTime() - periods[0]!.startAt.getTime(), 7 * 86400000);
  }
});

test('interest service defaults list pages to twenty and validates cursor filter binding', async () => {
  const { repository, queries } = createRepository(0);
  const service = new InterestService(repository, { analysisWindowDays: 7, minimumSampleSize: 10 });
  const cursor = encodeInterestCursor({
    likedAt: new Date('2026-09-14T12:00:00.000Z'),
    issueId: generateUuidV7(),
    categoryCode: 'housing',
  });

  await service.getLikedIssues(generateUuidV7(), { categoryCode: 'housing', cursor });

  assert.equal(queries[0]?.limit, 20);
  assert.equal(queries[0]?.categoryCode, 'housing');
  assert.equal(
    (queries[0]?.cursor as { categoryCode?: string } | undefined)?.categoryCode,
    'housing',
  );
});
