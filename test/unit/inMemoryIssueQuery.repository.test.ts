import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { InMemoryIssueQueryRepository } from '../fixtures/issue/inMemoryIssueQuery.repository.js';
import type {
  FeedBatchRecord,
  FeedSessionRecord,
  IssueCandidateScope,
  IssueRecord,
} from '@newtine/core';

test('in-memory feed batch save keeps the first concurrent write', async () => {
  const repository = new InMemoryIssueQueryRepository();
  const session = await repository.createFeedSession(
    { userId: null, guestKey: 'guest-hash' },
    new Date('2026-01-01T00:00:00.000Z'),
  );
  const first = batch(session, 'first');
  const second = batch(session, 'second');

  await Promise.all([
    repository.saveFeedBatch(session, first),
    repository.saveFeedBatch(session, second),
  ]);

  const stored = await repository.findFeedBatch(session.id, 0);
  assert.equal(stored?.items[0]?.reasonCodes[0], 'first');
});

test('scoped candidates reserve a personalized slice before global ranking', async () => {
  const personalized = issue(1, {
    categoryCode: 'selected',
    importanceScore: 0.1,
    freshnessScore: 0.1,
  });
  const major = issue(2, {
    categoryCode: 'acted',
    importanceScore: 0.95,
    freshnessScore: 0.95,
  });
  const repository = new InMemoryIssueQueryRepository({ issues: [personalized, major] });
  const scope = candidateScope({
    selectedCategoryCodes: ['selected'],
    actedCategoryCodes: ['acted'],
  });

  const unscoped = await repository.findCandidates(new Set(), 1);
  const scoped = await repository.findCandidates(new Set(), 1, scope);

  assert.deepEqual(
    unscoped.map((candidate) => candidate.id),
    [major.id],
  );
  assert.deepEqual(
    scoped.map((candidate) => candidate.id),
    [personalized.id],
  );
});

test('scoped candidate fill honors excluded ids, the limit, and public filtering', async () => {
  const excluded = issue(1, {
    categoryCode: 'selected',
    importanceScore: 0.95,
    freshnessScore: 0.95,
  });
  const personalized = issue(2, {
    categoryCode: 'selected',
    importanceScore: 0.9,
    freshnessScore: 0.9,
  });
  const mismatchMajor = issue(3, {
    categoryCode: 'other',
    importanceScore: 0.8,
    freshnessScore: 0.8,
  });
  const fallback = issue(4, {
    categoryCode: 'other',
    importanceScore: 0.6,
    freshnessScore: 0.6,
  });
  const unpublished = issue(5, {
    categoryCode: 'other',
    importanceScore: 1,
    freshnessScore: 1,
    publicationStatus: 'UNPUBLISHED',
  });
  const missingSummary = issue(6, {
    categoryCode: 'other',
    importanceScore: 1,
    freshnessScore: 1,
    integratedSummary: null,
  });
  const repository = new InMemoryIssueQueryRepository({
    issues: [excluded, personalized, mismatchMajor, fallback, unpublished, missingSummary],
  });
  const scope = candidateScope({
    selectedCategoryCodes: ['selected'],
    actedCategoryCodes: ['other'],
  });

  const candidates = await repository.findCandidates(new Set([excluded.id]), 3, scope);

  assert.equal(candidates.length, 3);
  assert.equal(
    candidates.some((candidate) => candidate.id === excluded.id),
    false,
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    [personalized.id, mismatchMajor.id, fallback.id],
  );
});

function issue(index: number, overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    title: `이슈 ${index}`,
    categoryCode: `category-${index}`,
    categoryName: `분류 ${index}`,
    subCategory: null,
    mainTopic: null,
    representativeEntityId: null,
    entityIds: [],
    regionCodes: [],
    ageGroups: [],
    eventAt: new Date(`2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`),
    publicationStatus: 'PUBLISHED',
    freshnessScore: 0.8,
    importanceScore: 0.8,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    integratedSummary: `요약 ${index}`,
    summaryLines: [`사실 ${index}`, `쟁점 ${index}`, `영향 ${index}`],
    viewpoints: null,
    glossary: [],
    articles: [],
    articleCount: 0,
    impacts: [],
    ...overrides,
  };
}

function candidateScope(overrides: Partial<IssueCandidateScope> = {}): IssueCandidateScope {
  return {
    highScoreThreshold: 0.7,
    selectedCategoryCodes: [],
    selectedEntityIds: [],
    preferredRegionCodes: [],
    ageGroup: null,
    actedCategoryCodes: [],
    connectedIssueIds: [],
    ...overrides,
  };
}

function batch(session: FeedSessionRecord, reason: string): FeedBatchRecord {
  return {
    sessionId: session.id,
    batchNo: 0,
    items: [
      {
        issueId: '00000000-0000-7000-8000-000000000010',
        position: 1,
        selectionType: 'MAJOR',
        reasonCodes: [reason],
      },
    ],
    continuation: 'CONTINUE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
