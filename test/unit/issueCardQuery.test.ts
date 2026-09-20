import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { IssueDetailService } from '@newtine/api/issue/issueDetail.service.js';
import { IssueFeedService } from '@newtine/api/issue/issueFeed.service.js';
import { recommendFeed } from '@newtine/api/issue/recommendation/issueRecommendation.js';
import { InMemoryIssueQueryRepository } from '../fixtures/issue/inMemoryIssueQuery.repository.js';
import { testTransactionManager } from '../fixtures/transactionManager.js';
import { toIssueDetailResponse } from '@newtine/api/issue/type/issueDetail.mapper.js';
import type {
  IssueRecord,
  IssueRelationRecord,
  TransactionManager,
  UserInteractionRecord,
  UserRecommendationContext,
} from '@newtine/core';

const USER_ID = '00000000-0000-7000-8000-000000000001';

test('feed returns at most ten unique cards and reuses the same batch on retry', async () => {
  const repository = new InMemoryIssueQueryRepository({
    issues: Array.from({ length: 12 }, (_, index) => issue(index + 1)),
  });
  const service = new IssueFeedService(repository, testTransactionManager);
  const session = await service.createSession({ kind: 'MEMBER', userId: USER_ID });
  const owner = { kind: 'MEMBER' as const, userId: USER_ID };

  const [first, retry] = await Promise.all([
    service.getBatch({
      owner,
      sessionId: session.sessionId,
      batchNo: 0,
    }),
    service.getBatch({
      owner,
      sessionId: session.sessionId,
      batchNo: 0,
    }),
  ]);
  assert.equal(first.items.length, 10);
  assert.deepEqual(
    retry.items.map((item) => item.issueId),
    first.items.map((item) => item.issueId),
  );

  const second = await service.getBatch({
    owner,
    sessionId: session.sessionId,
    batchNo: 1,
  });
  assert.equal(second.items.length, 2);
  assert.equal(new Set(second.items.map((item) => item.issueId)).size, 2);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.issueId)).size, 12);
  assert.equal(second.continuation, 'EXHAUSTED');
  await assert.rejects(
    service.getBatch({
      owner,
      sessionId: session.sessionId,
      batchNo: 2,
    }),
    /완료된 탐색 세션/,
  );
});

test('single feed collection starts an internal session and advances by an opaque position', async () => {
  const repository = new InMemoryIssueQueryRepository({
    issues: Array.from({ length: 12 }, (_, index) => issue(index + 1)),
  });
  const service = new IssueFeedService(repository, testTransactionManager);
  const owner = { kind: 'MEMBER' as const, userId: USER_ID };

  const first = await service.getFeed(owner);
  const second = await service.getFeed(owner, {
    sessionId: first.sessionId,
    batchNo: first.nextBatchNo ?? 1,
  });

  assert.equal(first.items.length, 10);
  assert.equal(second.items.length, 2);
  assert.equal(second.continuation, 'EXHAUSTED');
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.issueId)).size, 12);
});

test('feed batch generation is owned by the supplied transaction manager', async () => {
  const repository = new InMemoryIssueQueryRepository({ issues: [issue(1)] });
  let transactionCalls = 0;
  const transactionManager: TransactionManager = {
    execute: async (work) => {
      transactionCalls += 1;
      return work();
    },
  };
  const service = new IssueFeedService(repository, transactionManager);
  const session = await service.createSession({ kind: 'MEMBER', userId: USER_ID });

  await service.getBatch({
    owner: { kind: 'MEMBER', userId: USER_ID },
    sessionId: session.sessionId,
    batchNo: 0,
  });

  assert.equal(transactionCalls, 2);
});

test('feed preparation stays outside the transaction and only the save is transactional', async () => {
  const repository = new InMemoryIssueQueryRepository({ issues: [issue(1)] });
  let transactionDepth = 0;
  const originalFindCandidates = repository.findCandidates.bind(repository);
  repository.findCandidates = async (excludedIssueIds, limit, scope) => {
    assert.equal(transactionDepth, 0);
    return originalFindCandidates(excludedIssueIds, limit, scope);
  };
  const originalSaveFeedBatch = repository.saveFeedBatch.bind(repository);
  repository.saveFeedBatch = async (session, batch) => {
    assert.equal(transactionDepth, 1);
    return originalSaveFeedBatch(session, batch);
  };
  const transactionManager: TransactionManager = {
    execute: async (work) => {
      transactionDepth += 1;
      try {
        return await work();
      } finally {
        transactionDepth -= 1;
      }
    },
  };
  const service = new IssueFeedService(repository, transactionManager);
  const session = await service.createSession({ kind: 'MEMBER', userId: USER_ID });

  await service.getBatch({
    owner: { kind: 'MEMBER', userId: USER_ID },
    sessionId: session.sessionId,
    batchNo: 0,
  });
});

test('guest feed uses an anonymous owner and skips member context reads', async () => {
  let contextCalls = 0;
  let interactionCalls = 0;
  const repository = new InMemoryIssueQueryRepository({
    issues: Array.from({ length: 12 }, (_, index) => issue(index + 1)),
  });
  repository.findUserContext = async () => {
    contextCalls += 1;
    return context();
  };
  repository.findLatestInteractions = async () => {
    interactionCalls += 1;
    return [];
  };
  const service = new IssueFeedService(repository, testTransactionManager);
  const owner = { kind: 'GUEST' as const, guestTokenHash: 'a'.repeat(64) };
  const secondOwner = { kind: 'GUEST' as const, guestTokenHash: 'b'.repeat(64) };
  const session = await service.createSession(owner);
  const secondSession = await service.createSession(secondOwner);
  const result = await service.getBatch({ owner, sessionId: session.sessionId, batchNo: 0 });
  const secondResult = await service.getBatch({
    owner: secondOwner,
    sessionId: secondSession.sessionId,
    batchNo: 0,
  });

  assert.equal(result.items.length, 10);
  assert.deepEqual(
    secondResult.items.map((item) => item.issueId),
    result.items.map((item) => item.issueId),
  );
  assert.deepEqual(repository.getStoredSession(session.sessionId)?.owner, owner);
  assert.equal(contextCalls, 0);
  assert.equal(interactionCalls, 0);
  await assert.rejects(
    service.getBatch({
      owner: { kind: 'MEMBER', userId: USER_ID },
      sessionId: session.sessionId,
      batchNo: 0,
    }),
    /탐색 세션을 찾을 수 없습니다/,
  );
});

test('connected cards require a verified later FOLLOW_UP event', async () => {
  const source = issue(1, {
    eventAt: new Date('2026-01-01T00:00:00.000Z'),
    categoryCode: 'housing',
  });
  const later = issue(2, {
    eventAt: new Date('2026-01-02T00:00:00.000Z'),
    categoryCode: 'housing',
  });
  const sameTime = issue(3, {
    eventAt: new Date('2026-01-01T00:00:00.000Z'),
    categoryCode: 'housing',
  });
  const repository = new InMemoryIssueQueryRepository({
    issues: [source, later, sameTime],
    contexts: [context()],
    interactions: [interaction(source.id)],
    relations: [relation(source.id, later.id), relation(source.id, sameTime.id)],
  });
  const service = new IssueFeedService(repository, testTransactionManager);
  const session = await service.createSession({ kind: 'MEMBER', userId: USER_ID });
  const result = await service.getBatch({
    owner: { kind: 'MEMBER', userId: USER_ID },
    sessionId: session.sessionId,
    batchNo: 0,
  });

  const connected = result.items.filter((item) => item.selectionType === 'CONNECTED');
  assert.deepEqual(
    connected.map((item) => item.issueId),
    [later.id],
  );
  assert.equal(
    result.items.some((item) => item.issueId === source.id),
    false,
  );
});

test('detail exposes only public content and matching age impacts', async () => {
  const publicIssue = issue(1, {
    impacts: [
      {
        targetType: 'AGE_GROUP',
        targetValue: 'AGE_19_34',
        description: '맞춤 영향',
        timing: null,
        action: null,
      },
      {
        targetType: 'AGE_GROUP',
        targetValue: 'AGE_35_49',
        description: '다른 영향',
        timing: null,
        action: null,
      },
      {
        targetType: 'REGION',
        targetValue: 'SEOUL',
        description: '지역 영향',
        timing: null,
        action: null,
      },
    ],
  });
  const repository = new InMemoryIssueQueryRepository({
    issues: [publicIssue],
    contexts: [context()],
  });
  const service = new IssueDetailService(repository);
  const result = await service.get(publicIssue.id, USER_ID);
  assert.deepEqual(result.issue.impacts, publicIssue.impacts);
  assert.equal(result.context?.ageGroup, 'AGE_19_34');
  assert.deepEqual(
    toIssueDetailResponse(result).impacts.map((impact) => impact.targetValue),
    ['AGE_19_34'],
  );
});

test('run counters include every card selected in the current batch', () => {
  const first = issue(1, { mainTopic: 'same-topic' });
  const second = issue(2, { mainTopic: 'same-topic' });
  const result = recommendFeed({
    issues: [first, second],
    context: null,
    latestInteractions: [],
    actedCategoryCodes: new Set(),
    connectedIssueIds: new Set(),
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.lastTopic, 'same-topic');
  assert.equal(result.topicRun, 2);
});

test('run constraints are reported as limited instead of exhausted', () => {
  const result = recommendFeed({
    issues: [
      issue(1, { mainTopic: 'same-topic' }),
      issue(2, { mainTopic: 'same-topic' }),
      issue(3, { mainTopic: 'same-topic' }),
    ],
    context: null,
    latestInteractions: [],
    actedCategoryCodes: new Set(),
    connectedIssueIds: new Set(),
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.continuation, 'CONSTRAINT_LIMITED');
});

test('bounded replacement uncertainty is reported as search limited', () => {
  const result = recommendFeed({
    issues: [
      ...Array.from({ length: 10 }, (_, index) =>
        issue(index + 1, {
          mainTopic: 'same-topic',
          representativeEntityId: 'same-entity',
        }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        issue(index + 11, {
          mainTopic: `alternative-topic-${index}`,
          representativeEntityId: 'same-entity',
        }),
      ),
    ],
    context: null,
    latestInteractions: [],
    actedCategoryCodes: new Set(),
    connectedIssueIds: new Set(),
    candidateBudget: 20,
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.continuation, 'SEARCH_LIMITED');
});

test('limited batch can be retried but cannot create a new batch', async () => {
  const repository = new InMemoryIssueQueryRepository({
    issues: Array.from({ length: 3 }, (_, index) => issue(index + 1, { mainTopic: 'same-topic' })),
  });
  const service = new IssueFeedService(repository, testTransactionManager);
  const session = await service.createSession({ kind: 'MEMBER', userId: USER_ID });
  const owner = { kind: 'MEMBER' as const, userId: USER_ID };

  const first = await service.getBatch({ owner, sessionId: session.sessionId, batchNo: 0 });
  assert.equal(first.continuation, 'CONSTRAINT_LIMITED');
  const retry = await service.getBatch({ owner, sessionId: session.sessionId, batchNo: 0 });
  assert.deepEqual(
    retry.items.map((item) => item.issueId),
    first.items.map((item) => item.issueId),
  );

  await assert.rejects(
    service.getBatch({ owner, sessionId: session.sessionId, batchNo: 1 }),
    /제한 상태의 탐색 세션/,
  );
  assert.equal((await repository.findFeedBatches(session.sessionId)).length, 1);
});

test('candidate budget takes precedence when run constraints also limit output', () => {
  const result = recommendFeed({
    issues: Array.from({ length: 11 }, (_, index) => issue(index + 1, { mainTopic: 'same-topic' })),
    context: null,
    latestInteractions: [],
    actedCategoryCodes: new Set(),
    connectedIssueIds: new Set(),
    candidateBudget: 10,
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.continuation, 'SEARCH_LIMITED');
});

test('quota matching keeps rare personalized slots when major candidates rank higher', () => {
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
  const result = recommendFeed({
    issues: [...major, ...personal],
    context: { ...context(), selectedCategoryCodes: ['selected'] },
    latestInteractions: [],
    actedCategoryCodes: new Set(['acted']),
    connectedIssueIds: new Set(),
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  });

  assert.equal(result.items.filter((item) => item.selectionType === 'PERSONALIZED').length, 4);
  assert.equal(result.items.filter((item) => item.selectionType === 'MAJOR').length, 2);
});

test('run-aware replacement considers candidates after the initial ten', () => {
  const sameTopic = Array.from({ length: 10 }, (_, index) =>
    issue(index + 1, { mainTopic: 'same-topic' }),
  );
  const alternatives = Array.from({ length: 10 }, (_, index) => issue(index + 11));
  const result = recommendFeed({
    issues: [...sameTopic, ...alternatives],
    context: null,
    latestInteractions: [],
    actedCategoryCodes: new Set(),
    connectedIssueIds: new Set(),
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  });

  assert.equal(result.items.length, 10);
  assert.equal(new Set(result.items.map((item) => item.issueId)).size, 10);
  assert.equal(result.continuation, 'CONTINUE');
});

test('run-aware replacement scans the configured candidate budget', () => {
  const crowded = Array.from({ length: 110 }, (_, index) =>
    issue(index + 1, { mainTopic: 'same-topic' }),
  );
  const alternatives = Array.from({ length: 10 }, (_, index) =>
    issue(index + 111, { mainTopic: `alternative-topic-${index}` }),
  );
  const result = recommendFeed({
    issues: [...crowded, ...alternatives],
    context: null,
    latestInteractions: [],
    actedCategoryCodes: new Set(),
    connectedIssueIds: new Set(),
    candidateBudget: 120,
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  });

  assert.equal(result.items.length, 10);
  assert.equal(result.continuation, 'CONTINUE');
  assert.equal(
    result.items.some((item) => item.issueId === alternatives[0]!.id),
    true,
  );
});

test('run-order ties prefer the quota-complete path after prefix saturation', () => {
  const candidates = [
    issue(1, {
      categoryCode: 'selected',
      mainTopic: 'B',
      representativeEntityId: 'C',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
    issue(2, {
      categoryCode: 'selected',
      mainTopic: 'B',
      representativeEntityId: null,
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
    issue(3, {
      categoryCode: 'selected',
      mainTopic: null,
      representativeEntityId: 'A',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
    issue(4, {
      categoryCode: 'selected',
      mainTopic: 'B',
      representativeEntityId: 'B',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
    issue(5, {
      categoryCode: 'selected',
      mainTopic: 'B',
      representativeEntityId: 'A',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
    issue(6, {
      categoryCode: 'selected',
      mainTopic: null,
      representativeEntityId: 'A',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
    issue(7, {
      categoryCode: '',
      mainTopic: 'B',
      representativeEntityId: 'C',
      importanceScore: 0.95,
      freshnessScore: 0.95,
    }),
    issue(8, {
      categoryCode: '',
      mainTopic: 'B',
      representativeEntityId: 'B',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
    issue(9, {
      categoryCode: 'e1',
      mainTopic: 'B',
      representativeEntityId: 'A',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
    issue(10, {
      categoryCode: 'e2',
      mainTopic: 'B',
      representativeEntityId: 'C',
      importanceScore: 0.1,
      freshnessScore: 0.1,
    }),
  ];
  const result = recommendFeed({
    issues: candidates,
    context: {
      userId: USER_ID,
      selectedCategoryCodes: ['selected'],
      selectedEntityIds: [],
      preferredRegionCodes: [],
      ageGroup: null,
    },
    latestInteractions: [],
    actedCategoryCodes: new Set(['']),
    connectedIssueIds: new Set([candidates[7]!.id]),
    previousSession: {
      lastTopic: 'C',
      lastRepresentativeEntityId: 'A',
      topicRun: 2,
      entityRun: 2,
    },
  });

  assert.equal(result.items.length, 8);
  assert.equal(result.items.filter((item) => item.selectionType === 'PERSONALIZED').length, 4);
  assert.equal(result.items.filter((item) => item.selectionType === 'MAJOR').length, 1);
  assert.equal(result.items.filter((item) => item.selectionType === 'CONNECTED').length, 1);
  assert.equal(result.items.filter((item) => item.selectionType === 'EXPLORATION').length, 2);
  assert.equal(result.continuation, 'CONSTRAINT_LIMITED');
});

test('missing candidate tags are not treated as known mismatches', () => {
  const candidate = issue(1, { ageGroups: [], regionCodes: [], entityIds: [] });
  const result = recommendFeed({
    issues: [candidate],
    context: context(),
    latestInteractions: [],
    actedCategoryCodes: new Set(),
    connectedIssueIds: new Set(),
    previousSession: {
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    },
  });

  assert.equal(
    result.items.some((item) => item.selectionType === 'OPPOSITE'),
    false,
  );
});

function issue(index: number, overrides: Partial<IssueRecord> = {}): IssueRecord {
  const id = `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`;
  return {
    id,
    title: `이슈 ${index}`,
    categoryCode: `category-${index}`,
    categoryName: `분류 ${index}`,
    subCategory: null,
    mainTopic: `topic-${index}`,
    representativeEntityId: null,
    entityIds: [],
    regionCodes: [],
    ageGroups: [],
    eventAt: new Date(`2026-01-${String(Math.min(index, 28)).padStart(2, '0')}T00:00:00.000Z`),
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

function context(): UserRecommendationContext {
  return {
    userId: USER_ID,
    selectedCategoryCodes: ['housing'],
    selectedEntityIds: [],
    preferredRegionCodes: [],
    ageGroup: 'AGE_19_34',
  };
}

function interaction(issueId: string): UserInteractionRecord {
  return {
    id: '00000000-0000-7000-8000-100000000001',
    userId: USER_ID,
    issueId,
    eventType: 'LIKE',
    createdAt: new Date('2026-01-01T01:00:00.000Z'),
  };
}

function relation(fromIssueId: string, toIssueId: string): IssueRelationRecord {
  return {
    fromIssueId,
    toIssueId,
    relationType: 'FOLLOW_UP',
    verifiedAt: new Date('2026-01-03T00:00:00.000Z'),
  };
}
