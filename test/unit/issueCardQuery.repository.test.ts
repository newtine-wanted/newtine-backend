import assert from 'node:assert/strict';
import { EntityManager } from '@mikro-orm/core';
import { test } from '@jest/globals';

import { IssueCardQueryRepository } from '@newtine/api/issue/repository/issueCardQuery.repository.js';
import type { FeedBatchRecord, FeedSessionRecord, IssueCandidateScope } from '@newtine/core';
import {
  FeedBatchEntity,
  FeedBatchItemEntity,
  FeedSessionEntity,
  IssueQueryArticleEntity,
  IssueQueryArticleLinkEntity,
  IssueQueryDetailEntity,
  IssueQueryEntityLinkEntity,
  IssueQueryImpactEntity,
  IssueQueryInteractionEntity,
  IssueQueryIssueEntity,
  IssueQueryPublisherEntity,
  IssueQueryRelationEntity,
  type FeedBatchItemPersistenceEntity,
  type FeedBatchPersistenceEntity,
  type FeedSessionPersistenceEntity,
  type IssueQueryArticleLinkPersistenceEntity,
  type IssueQueryArticlePersistenceEntity,
  type IssueQueryDetailPersistenceEntity,
  type IssueQueryEntityLinkPersistenceEntity,
  type IssueQueryImpactPersistenceEntity,
  type IssueQueryInteractionPersistenceEntity,
  type IssueQueryIssuePersistenceEntity,
  type IssueQueryPublisherPersistenceEntity,
  type IssueQueryRelationPersistenceEntity,
} from '@newtine/core/issue/persistence/issueQuery.persistence.entity.js';
import { IssueCategorySchema } from '@newtine/core/onboarding/persistence/onboarding.persistence.entity.js';

const SESSION_ID = '00000000-0000-7000-8000-000000000001';
const ISSUE_ID = '00000000-0000-7000-8000-000000000020';
const ARTICLE_ID = '00000000-0000-7000-8000-000000000021';

test('issue card projection uses EntityManager metadata and available article policy', async () => {
  const issueRow = issuePersistenceRow(ISSUE_ID);
  const detail: IssueQueryDetailPersistenceEntity = {
    id: '00000000-0000-7000-8000-000000000022',
    issueId: ISSUE_ID,
    integratedSummary: '요약',
    summaryLines: ['첫째', '둘째', '셋째'],
    viewpoints: [{ statement: '관점', articleIds: [ARTICLE_ID] }],
    glossary: [{ term: '용어', definition: '설명', articleIds: [ARTICLE_ID] }],
  };
  const impact: IssueQueryImpactPersistenceEntity = {
    id: '00000000-0000-7000-8000-000000000023',
    issueId: ISSUE_ID,
    targetType: 'AGE_GROUP',
    targetValue: 'AGE_19_34',
    description: '영향',
    articleIds: [],
  };
  const entityLink: IssueQueryEntityLinkPersistenceEntity = {
    issueEntitiesId: '00000000-0000-7000-8000-000000000024',
    issueId: ISSUE_ID,
    entityId: '00000000-0000-7000-8000-000000000025',
  };
  const article: IssueQueryArticlePersistenceEntity = {
    id: ARTICLE_ID,
    publisherId: '00000000-0000-7000-8000-000000000026',
    title: '사용 가능한 기사',
    articleUrl: 'https://example.com/available',
    publisherName: '기본 언론사',
    publishedAt: null,
    sourceStatus: 'AVAILABLE',
  };
  const publisher: IssueQueryPublisherPersistenceEntity = {
    id: article.publisherId!,
    name: '테스트 언론',
  };
  const articleLink: IssueQueryArticleLinkPersistenceEntity = {
    issueId: ISSUE_ID,
    articleId: ARTICLE_ID,
    sortOrder: 1,
  };
  const { entityManager, calls } = fakeEntityManager({
    find: async (entity) => {
      if (entity === IssueQueryIssueEntity) return [issueRow];
      if (entity === IssueCategorySchema) {
        return [{ code: 'housing', displayName: '주거' }];
      }
      if (entity === IssueQueryDetailEntity) return [detail];
      if (entity === IssueQueryImpactEntity) return [impact];
      if (entity === IssueQueryEntityLinkEntity) return [entityLink];
      if (entity === IssueQueryArticleLinkEntity) return [articleLink];
      if (entity === IssueQueryArticleEntity) return [article];
      if (entity === IssueQueryPublisherEntity) return [publisher];
      return [];
    },
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const issue = await repository.findIssue(ISSUE_ID);

  assert.equal(issue?.categoryName, '주거');
  assert.equal(issue?.integratedSummary, '요약');
  assert.deepEqual(issue?.ageGroups, ['AGE_19_34']);
  assert.deepEqual(issue?.entityIds, [entityLink.entityId]);
  assert.equal(issue?.articleCount, 1);
  assert.equal(issue?.articles[0]?.publisherName, '테스트 언론');
  assert.deepEqual(calls, [
    'find:IssueQueryIssue',
    'find:IssueCategory',
    'find:IssueQueryDetail',
    'find:IssueQueryImpact',
    'find:IssueQueryEntityLink',
    'find:IssueQueryArticleLink',
    'find:IssueQueryArticle',
    'find:IssueQueryPublisher',
  ]);
});

test('scoped candidates use ORM projections, public filtering, exclusion, and bounded slices', async () => {
  const selected = issuePersistenceRow('00000000-0000-7000-8000-000000000030', {
    categoryCode: 'selected',
    importanceScore: 0.1,
    freshnessScore: 0.1,
  });
  const major = issuePersistenceRow('00000000-0000-7000-8000-000000000031', {
    categoryCode: 'other',
    importanceScore: 0.95,
    freshnessScore: 0.95,
  });
  const unpublished = issuePersistenceRow('00000000-0000-7000-8000-000000000032', {
    categoryCode: 'other',
    importanceScore: 1,
    freshnessScore: 1,
    publicationStatus: 'UNPUBLISHED',
  });
  const scope: IssueCandidateScope = {
    highScoreThreshold: 0.8,
    selectedCategoryCodes: ['selected'],
    selectedEntityIds: [],
    preferredRegionCodes: [],
    ageGroup: null,
    actedCategoryCodes: ['acted'],
    connectedIssueIds: [],
  };
  const candidateLimits: unknown[] = [];
  let issueQueryCalls = 0;
  const { entityManager } = fakeEntityManager({
    find: async (entity, _where, options) => {
      if (entity === IssueQueryIssueEntity) {
        issueQueryCalls += 1;
        if (isFindOptionsWithLimit(options)) candidateLimits.push(options.limit);
        if (issueQueryCalls === 1) return [selected];
        if (issueQueryCalls === 2) return [major];
        return [selected, major, unpublished];
      }
      if (entity === IssueCategorySchema) {
        return [
          { code: 'selected', displayName: '선택' },
          { code: 'other', displayName: '기타' },
        ];
      }
      if (entity === IssueQueryDetailEntity) {
        return [selected, major, unpublished].map((row) => detailFor(row.id));
      }
      return [];
    },
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const candidates = await repository.findCandidates(new Set(), 2, scope);

  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    [selected.id, major.id],
  );
  assert.deepEqual(candidateLimits, [1, 1]);
});

test('feed batch persistence uses a transaction, row locks, and ORM writes', async () => {
  const currentSession = feedSessionPersistenceRow();
  const created: Array<{ entity: unknown; data: object }> = [];
  const { entityManager, flushCount } = fakeEntityManager({
    isInTransaction: () => true,
    count: () => 1,
    findOne: async (entity) => {
      if (entity === FeedSessionEntity) return currentSession;
      return null;
    },
    create: (entity, data) => {
      created.push({ entity, data });
      return data;
    },
  });
  const repository = new IssueCardQueryRepository(entityManager);

  await repository.saveFeedBatch(session(), batch(0));

  assert.equal(flushCount(), 1);
  assert.equal(
    created.some((entry) => entry.entity === FeedBatchEntity),
    true,
  );
  assert.equal(
    created.some((entry) => entry.entity === FeedBatchItemEntity),
    true,
  );
  assert.equal(currentSession.nextBatchNo, 1);
});

test('feed batch persistence rejects an expired locked session before writing', async () => {
  const currentSession = feedSessionPersistenceRow({ expiresAt: new Date(0) });
  let createCalls = 0;
  const { entityManager } = fakeEntityManager({
    isInTransaction: () => true,
    count: () => 0,
    findOne: async (entity) => (entity === FeedSessionEntity ? currentSession : null),
    create: (_entity, data) => {
      createCalls += 1;
      return data;
    },
  });
  const repository = new IssueCardQueryRepository(entityManager);

  await assert.rejects(repository.saveFeedBatch(session(), batch(0)), /만료/);
  assert.equal(createCalls, 0);
});

test('feed batches bulk-load items through the ORM adapter', async () => {
  const rows: FeedBatchPersistenceEntity[] = [
    {
      feedSessionId: SESSION_ID,
      batchNo: 0,
      continuation: 'CONTINUE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      feedSessionId: SESSION_ID,
      batchNo: 1,
      continuation: 'EXHAUSTED',
      createdAt: new Date('2026-01-01T00:01:00.000Z'),
    },
  ];
  const items: FeedBatchItemPersistenceEntity[] = [
    {
      feedSessionId: SESSION_ID,
      batchNo: 0,
      position: 1,
      issueId: '00000000-0000-7000-8000-000000000010',
      selectionType: 'MAJOR',
      reasonCodes: ['MAJOR_SCORE'],
    },
    {
      feedSessionId: SESSION_ID,
      batchNo: 1,
      position: 1,
      issueId: '00000000-0000-7000-8000-000000000011',
      selectionType: 'EXPLORATION',
      reasonCodes: [],
    },
  ];
  const { entityManager } = fakeEntityManager({
    find: async (entity) =>
      entity === FeedBatchEntity ? rows : entity === FeedBatchItemEntity ? items : [],
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const batches = await repository.findFeedBatches(SESSION_ID);

  assert.deepEqual(
    batches.map((stored) => stored.items.map((item) => item.issueId)),
    [['00000000-0000-7000-8000-000000000010'], ['00000000-0000-7000-8000-000000000011']],
  );
});

test('latest interactions and verified follow-ups are read through EntityManager', async () => {
  const interactionRows: IssueQueryInteractionPersistenceEntity[] = [
    {
      id: '00000000-0000-7000-8000-000000000040',
      userId: '00000000-0000-7000-8000-000000000041',
      issueId: ISSUE_ID,
      eventType: 'LIKE',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    {
      id: '00000000-0000-7000-8000-000000000042',
      userId: '00000000-0000-7000-8000-000000000041',
      issueId: ISSUE_ID,
      eventType: 'SKIP',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];
  const relation: IssueQueryRelationPersistenceEntity = {
    fromIssueId: ISSUE_ID,
    toIssueId: '00000000-0000-7000-8000-000000000043',
    relationType: 'FOLLOW_UP',
    reason: '후속 보도',
    evidenceRefs: [],
    verifiedAt: new Date('2026-01-03T00:00:00.000Z'),
  };
  const { entityManager } = fakeEntityManager({
    find: async (entity) =>
      entity === IssueQueryInteractionEntity
        ? interactionRows
        : entity === IssueQueryRelationEntity
          ? [relation]
          : [],
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const interactions = await repository.findLatestInteractions(interactionRows[0]!.userId);
  const followUps = await repository.findFollowUps(new Set([ISSUE_ID]));

  assert.equal(interactions.length, 1);
  assert.equal(interactions[0]?.eventType, 'LIKE');
  assert.deepEqual(followUps, [
    {
      fromIssueId: relation.fromIssueId,
      toIssueId: relation.toIssueId,
      relationType: 'FOLLOW_UP',
      verifiedAt: relation.verifiedAt,
    },
  ]);
});

interface FakeEntityManager {
  getContext: (useContext?: boolean) => FakeEntityManager;
  createQueryBuilder: (entity: unknown, alias?: string) => FakeQueryBuilder;
  isInTransaction: () => boolean;
  count: (entity: unknown, where: unknown) => Promise<number>;
  findOne: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown | null>;
  find: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown[]>;
  create: (entity: unknown, data: object) => unknown;
  persist: (entity: unknown) => void;
  flush: () => Promise<void>;
}

interface FakeQueryBuilder {
  readonly __subquery: true;
  select: (field: string) => FakeQueryBuilder;
  where: (where: unknown) => FakeQueryBuilder;
  andWhere: (where: unknown) => FakeQueryBuilder;
}

interface FakeEntityManagerOptions {
  createQueryBuilder?: FakeEntityManager['createQueryBuilder'];
  isInTransaction?: () => boolean;
  count?: (entity: unknown, where: unknown) => number | Promise<number>;
  findOne?: FakeEntityManager['findOne'];
  find?: FakeEntityManager['find'];
  create?: FakeEntityManager['create'];
}

function fakeEntityManager(options: FakeEntityManagerOptions = {}): {
  entityManager: EntityManager;
  calls: string[];
  flushCount: () => number;
} {
  const calls: string[] = [];
  const originalFind = options.find;
  let flushed = 0;
  const manager: FakeEntityManager = {
    getContext: () => manager,
    createQueryBuilder:
      options.createQueryBuilder ??
      ((entity, alias) => {
        const query: FakeQueryBuilder = {
          __subquery: true,
          select: () => query,
          where: () => query,
          andWhere: () => query,
        };
        void entity;
        void alias;
        return query;
      }),
    isInTransaction: options.isInTransaction ?? (() => false),
    count: async (entity, where) => (await options.count?.(entity, where)) ?? 0,
    findOne: async (entity, where, findOptions) => {
      calls.push(`findOne:${entityName(entity)}`);
      return options.findOne?.(entity, where, findOptions) ?? null;
    },
    find: async (entity, where, findOptions) => {
      calls.push(`find:${entityName(entity)}`);
      return originalFind?.(entity, where, findOptions) ?? [];
    },
    create: (entity, data) => options.create?.(entity, data) ?? data,
    persist: () => undefined,
    flush: async () => {
      flushed += 1;
    },
  };
  return {
    entityManager: manager as unknown as EntityManager,
    calls,
    flushCount: () => flushed,
  };
}

function isFindOptionsWithLimit(value: unknown): value is { limit: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'limit' in value &&
    typeof value.limit === 'number'
  );
}

function entityName(entity: unknown): string {
  if (entity === IssueQueryIssueEntity) return 'IssueQueryIssue';
  if (entity === IssueCategorySchema) return 'IssueCategory';
  if (entity === IssueQueryDetailEntity) return 'IssueQueryDetail';
  if (entity === IssueQueryImpactEntity) return 'IssueQueryImpact';
  if (entity === IssueQueryEntityLinkEntity) return 'IssueQueryEntityLink';
  if (entity === IssueQueryArticleLinkEntity) return 'IssueQueryArticleLink';
  if (entity === IssueQueryArticleEntity) return 'IssueQueryArticle';
  if (entity === IssueQueryPublisherEntity) return 'IssueQueryPublisher';
  if (entity === FeedBatchEntity) return 'FeedBatch';
  if (entity === FeedBatchItemEntity) return 'FeedBatchItem';
  if (entity === FeedSessionEntity) return 'FeedSession';
  if (entity === IssueQueryInteractionEntity) return 'IssueQueryInteraction';
  if (entity === IssueQueryRelationEntity) return 'IssueQueryRelation';
  return 'unknown';
}

function issuePersistenceRow(
  id: string,
  overrides: Partial<IssueQueryIssuePersistenceEntity> = {},
): IssueQueryIssuePersistenceEntity {
  return {
    id,
    categoryCode: 'housing',
    title: `이슈 ${id.slice(-4)}`,
    publicationStatus: 'PUBLISHED',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    eventAt: new Date('2026-01-01T00:00:00.000Z'),
    subCategory: null,
    freshnessScore: 0.8,
    importanceScore: 0.8,
    ...overrides,
  };
}

function detailFor(issueId: string): IssueQueryDetailPersistenceEntity {
  return {
    id: `00000000-0000-7000-8000-${issueId.slice(-8)}`,
    issueId,
    integratedSummary: '요약',
    summaryLines: ['첫째', '둘째', '셋째'],
    viewpoints: null,
    glossary: [],
  };
}

function feedSessionPersistenceRow(
  overrides: Partial<FeedSessionPersistenceEntity> = {},
): FeedSessionPersistenceEntity {
  return {
    id: SESSION_ID,
    userId: '00000000-0000-0000-0000-000000000001',
    algorithmVersion: 'issue-card-query-v1',
    nextBatchNo: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    lastTopic: null,
    lastRepresentativeEntityId: null,
    topicRun: 0,
    entityRun: 0,
    ...overrides,
  };
}

function session(): FeedSessionRecord {
  return {
    id: SESSION_ID,
    owner: { userId: '00000000-0000-0000-0000-000000000001' },
    algorithmVersion: 'issue-card-query-v1',
    nextBatchNo: 1,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    lastTopic: null,
    lastRepresentativeEntityId: null,
    topicRun: 0,
    entityRun: 0,
  };
}

function batch(batchNo: number): FeedBatchRecord {
  return {
    sessionId: SESSION_ID,
    batchNo,
    items: [
      {
        issueId: ISSUE_ID,
        position: 1,
        selectionType: 'MAJOR',
        reasonCodes: ['MAJOR_SCORE'],
      },
    ],
    continuation: 'CONTINUE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
