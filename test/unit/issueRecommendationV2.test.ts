import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2,
  recommendFeed,
} from '@newtine/api/issue/recommendation/issueRecommendation.js';
import type { RecommendationInput } from '@newtine/api/issue/recommendation/issueRecommendation.js';
import type { IssueRecord } from '@newtine/core';

test('v2가 전체 후보 예산을 확인한 뒤 연속 제한을 지키는 배치를 선택한다', () => {
  const crowded = Array.from({ length: 110 }, (_, index) =>
    issue(index + 1, { mainTopic: 'same-topic' }),
  );
  const alternatives = Array.from({ length: 10 }, (_, index) =>
    issue(index + 111, { mainTopic: `alternative-${index}` }),
  );

  const result = recommendFeed(
    recommendationInput([...crowded, ...alternatives], 120),
    ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2,
  );

  assert.equal(result.items.length, 10);
  assert.equal(result.continuation, 'CONTINUE');
  assert.equal(
    result.items.some((item) => item.issueId === alternatives[0]!.id),
    true,
  );
});

test('v2가 전체 후보를 확인한 제약 종료를 소진과 구분한다', () => {
  const result = recommendFeed(
    recommendationInput([
      issue(1, { mainTopic: 'same-topic' }),
      issue(2, { mainTopic: 'same-topic' }),
      issue(3, { mainTopic: 'same-topic' }),
    ]),
    ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2,
  );

  assert.equal(result.items.length, 2);
  assert.equal(result.continuation, 'CONSTRAINT_LIMITED');
});

test('v2가 후보 불확실성이 남은 경우 탐색 제한으로 분류한다', () => {
  const result = recommendFeed(
    recommendationInput(
      Array.from({ length: 11 }, (_, index) => issue(index + 1, { mainTopic: 'same-topic' })),
      10,
    ),
    ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2,
  );

  assert.equal(result.items.length, 2);
  assert.equal(result.continuation, 'SEARCH_LIMITED');
});

test('v2가 증명된 전체 후보 순서로 유효한 10장 배치를 복원한다', () => {
  const result = recommendFeed(
    recommendationInput(
      [
        issue(1, { mainTopic: 'C', representativeEntityId: 'A' }),
        issue(2, { mainTopic: 'C', representativeEntityId: null }),
        issue(3, { mainTopic: 'B', representativeEntityId: 'A' }),
        issue(4, { mainTopic: 'B', representativeEntityId: 'A' }),
        issue(5, { mainTopic: 'B', representativeEntityId: 'A' }),
        issue(6, { mainTopic: 'B', representativeEntityId: 'B' }),
        issue(7, { mainTopic: 'B', representativeEntityId: 'B' }),
        issue(8, { mainTopic: 'B', representativeEntityId: 'C' }),
        issue(9, { mainTopic: 'A', representativeEntityId: 'A' }),
        issue(10, { mainTopic: null, representativeEntityId: 'A' }),
      ],
      10,
    ),
    ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2,
  );

  assert.equal(result.items.length, 10);
  assert.equal(new Set(result.items.map((item) => item.issueId)).size, 10);
  assert.equal(result.continuation, 'CONTINUE');
});

test('v2가 예산 밖 적격 후보가 있으면 탐색 제한으로 유지한다', () => {
  const ineligible = Array.from({ length: 10 }, (_, index) =>
    issue(index + 1, {
      categoryCode: `acted-${index}`,
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
  );
  const result = recommendFeed(
    {
      ...recommendationInput([...ineligible, issue(11)], 10),
      actedCategoryCodes: new Set(ineligible.map((candidate) => candidate.categoryCode)),
    },
    ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2,
  );

  assert.equal(result.items.length, 0);
  assert.equal(result.continuation, 'SEARCH_LIMITED');
});

test('v2가 제한된 대안 탐색 이후에도 증명된 동일 주제 제약을 유지한다', () => {
  const result = recommendFeed(
    recommendationInput(
      Array.from({ length: 27 }, (_, index) => issue(index + 1, { mainTopic: 'same-topic' })),
      100,
    ),
    ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2,
  );

  assert.equal(result.items.length, 2);
  assert.equal(result.continuation, 'CONSTRAINT_LIMITED');
});

test('v2가 희소 선택 할당량을 보존하고 같은 입력에서 결정적으로 동작한다', () => {
  const personal = Array.from({ length: 4 }, (_, index) =>
    issue(index + 1, {
      categoryCode: 'selected',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
  );
  const major = Array.from({ length: 2 }, (_, index) =>
    issue(index + 5, {
      categoryCode: 'acted',
      importanceScore: 0.95,
      freshnessScore: 0.95,
    }),
  );
  const input = recommendationInput([...major, ...personal]);
  input.context = {
    userId: '00000000-0000-7000-8000-000000000001',
    selectedCategoryCodes: ['selected'],
    selectedEntityIds: [],
    preferredRegionCodes: [],
    ageGroup: null,
  };
  input.actedCategoryCodes = new Set(['acted']);

  const first = recommendFeed(input, ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2);
  const second = recommendFeed(input, ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2);

  assert.deepEqual(first.items, second.items);
  assert.equal(first.items.filter((item) => item.selectionType === 'PERSONALIZED').length, 4);
  assert.equal(first.items.filter((item) => item.selectionType === 'MAJOR').length, 2);
});

test('v2가 후보의 적격 선택 유형 밖으로 할당하지 않는다', () => {
  const input = recommendationInput(
    Array.from({ length: 12 }, (_, index) =>
      issue(index + 1, {
        categoryCode: 'selected',
        importanceScore: 0.1,
        freshnessScore: 0.1,
      }),
    ),
  );
  input.context = {
    userId: '00000000-0000-7000-8000-000000000001',
    selectedCategoryCodes: ['selected'],
    selectedEntityIds: [],
    preferredRegionCodes: [],
    ageGroup: null,
  };
  const result = recommendFeed(input, ISSUE_RECOMMENDATION_ALGORITHM_VERSION_V2);

  assert.equal(result.items.length, 10);
  assert.equal(
    result.items.every((item) => item.selectionType === 'PERSONALIZED'),
    true,
  );
});

function recommendationInput(issues: IssueRecord[], candidateBudget = 100): RecommendationInput {
  return {
    issues,
    context: null,
    latestInteractions: [],
    actedCategoryCodes: new Set<string>(),
    connectedIssueIds: new Set<string>(),
    candidateBudget,
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  };
}

function issue(index: number, overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    title: `이슈 ${index}`,
    categoryCode: `category-${index}`,
    categoryName: `분류 ${index}`,
    subCategory: null,
    mainTopic: `topic-${index}`,
    representativeEntityId: null,
    entityIds: [],
    regionCodes: [],
    ageGroups: [],
    eventAt: new Date('2026-01-01T00:00:00.000Z'),
    publicationStatus: 'PUBLISHED',
    freshnessScore: 0.8,
    importanceScore: 0.8,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    integratedSummary: '요약',
    summaryLines: ['사실', '쟁점', '영향'],
    viewpoints: null,
    glossary: [],
    articles: [],
    articleCount: 0,
    impacts: [],
    ...overrides,
  };
}
