import assert from 'node:assert/strict';
import { EntityManager, QueryOrder } from '@mikro-orm/core';
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
import {
  IssueCategorySchema,
  UserCategoryPreferenceSchema,
  UserEntityPreferenceSchema,
  UserRegionPreferenceSchema,
  UserSchema,
} from '@newtine/core/onboarding/persistence/onboarding.persistence.entity.js';

const SESSION_ID = '00000000-0000-7000-8000-000000000001';
const ISSUE_ID = '00000000-0000-7000-8000-000000000020';
const ARTICLE_ID = '00000000-0000-7000-8000-000000000021';

test('issue card projection uses EntityManager metadata and available article policy', async () => {
  const representativeEntityId = '00000000-0000-7000-8000-000000000025';
  const issueRow = issuePersistenceRow(ISSUE_ID, {
    mainTopic: 'housing',
    representativeEntityId,
  });
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
  assert.equal(issue?.mainTopic, 'housing');
  assert.equal(issue?.representativeEntityId, representativeEntityId);
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

test('feed card projection은 상세 기사 payload 없이 카드 계약 필드를 유지한다', async () => {
  const issueRow = issuePersistenceRow(ISSUE_ID, {
    title: '카드 제목',
    categoryCode: 'housing',
    freshnessScore: 0.7,
    importanceScore: 0.9,
  });
  const detail: IssueQueryDetailPersistenceEntity = {
    id: '00000000-0000-7000-8000-000000000022',
    issueId: ISSUE_ID,
    integratedSummary: '통합 요약',
    summaryLines: ['첫째', '둘째', '셋째'],
    viewpoints: [{ statement: '관점', articleIds: [] }],
    glossary: [{ term: '용어', definition: '설명', articleIds: [] }],
  };
  const fieldsByEntity = new Map<unknown, unknown>();
  const { entityManager } = fakeEntityManager({
    find: async (entity, _where, options) => {
      fieldsByEntity.set(entity, options);
      if (entity === IssueQueryIssueEntity) return [issueRow];
      if (entity === IssueCategorySchema) return [{ code: 'housing', displayName: '주거' }];
      if (entity === IssueQueryDetailEntity) return [detail];
      return [];
    },
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const cards = await repository.findFeedCards(new Set([ISSUE_ID]));

  assert.deepEqual(cards, [
    {
      id: ISSUE_ID,
      title: '카드 제목',
      categoryCode: 'housing',
      categoryName: '주거',
      eventAt: issueRow.eventAt,
      publishedAt: issueRow.publishedAt,
      integratedSummary: '통합 요약',
      summaryLines: ['첫째', '둘째', '셋째'],
      publicationStatus: 'PUBLISHED',
      freshnessScore: 0.7,
      importanceScore: 0.9,
      articleCount: 0,
    },
  ]);
  assert.deepEqual((fieldsByEntity.get(IssueQueryIssueEntity) as { fields: string[] }).fields, [
    'id',
    'title',
    'categoryCode',
    'eventAt',
    'publishedAt',
    'publicationStatus',
    'freshnessScore',
    'importanceScore',
  ]);
  assert.deepEqual((fieldsByEntity.get(IssueCategorySchema) as { fields: string[] }).fields, [
    'code',
    'displayName',
  ]);
  assert.deepEqual((fieldsByEntity.get(IssueQueryDetailEntity) as { fields: string[] }).fields, [
    'id',
    'issueId',
    'integratedSummary',
    'summaryLines',
  ]);
});

test('user context reads only positive onboarding preferences through ORM metadata', async () => {
  const userId = '00000000-0000-7000-8000-000000000001';
  const whereByEntity = new Map<unknown, unknown>();
  const fieldsByEntity = new Map<unknown, unknown>();
  const { entityManager } = fakeEntityManager({
    findOne: async (entity, _where, options) => {
      fieldsByEntity.set(entity, options);
      return entity === UserSchema ? { id: userId, ageGroup: 'AGE_35_49' } : null;
    },
    find: async (entity, where, options) => {
      whereByEntity.set(entity, where);
      fieldsByEntity.set(entity, options);
      if (entity === UserCategoryPreferenceSchema) {
        return [
          { categoryCode: 'politics', weight: 0 },
          { categoryCode: 'housing', weight: 2 },
          { categoryCode: 'retired', weight: -1 },
        ];
      }
      if (entity === UserEntityPreferenceSchema) {
        return [
          { entityId: '00000000-0000-7000-8000-000000000030', weight: 1 },
          { entityId: '00000000-0000-7000-8000-000000000031', weight: 0 },
        ];
      }
      if (entity === UserRegionPreferenceSchema) {
        return [
          { regionCode: 'SEOUL', weight: 1 },
          { regionCode: 'BUSAN', weight: -1 },
        ];
      }
      return [];
    },
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const context = await repository.findUserContext(userId);

  assert.deepEqual(context, {
    userId,
    selectedCategoryCodes: ['housing'],
    selectedEntityIds: ['00000000-0000-7000-8000-000000000030'],
    preferredRegionCodes: ['SEOUL'],
    ageGroup: 'AGE_35_49',
  });
  assert.deepEqual(whereByEntity.get(UserCategoryPreferenceSchema), {
    userId,
    weight: { $gt: 0 },
  });
  assert.deepEqual(whereByEntity.get(UserEntityPreferenceSchema), {
    userId,
    weight: { $gt: 0 },
  });
  assert.deepEqual(whereByEntity.get(UserRegionPreferenceSchema), {
    userId,
    weight: { $gt: 0 },
  });
  assert.deepEqual((fieldsByEntity.get(UserSchema) as { fields: string[] }).fields, [
    'id',
    'ageGroup',
  ]);
  assert.deepEqual(
    (fieldsByEntity.get(UserCategoryPreferenceSchema) as { fields: string[] }).fields,
    ['userCategoryPreferencesId', 'userId', 'categoryCode', 'weight'],
  );
  assert.deepEqual(
    (fieldsByEntity.get(UserEntityPreferenceSchema) as { fields: string[] }).fields,
    ['userEntityPreferenceId', 'userId', 'entityId', 'weight'],
  );
  assert.deepEqual(
    (fieldsByEntity.get(UserRegionPreferenceSchema) as { fields: string[] }).fields,
    ['id', 'userId', 'regionCode', 'weight'],
  );
});

test('통합 회원 피드 입력은 사용자 기준 단일 raw 조회와 positional parameter를 사용한다', async () => {
  const userId = '00000000-0000-0000-0000-000000000041';
  const entityId = '00000000-0000-0000-0000-000000000042';
  let queryText = '';
  let queryParams: unknown[] = [];
  const { entityManager, calls } = fakeEntityManager({
    getConnection: () => ({
      execute: async (query: string, params: unknown[]) => {
        queryText = query;
        queryParams = params;
        return [
          {
            user_id: userId,
            age_group: 'AGE_35_49',
            selected_category_codes: '{"zeta","alpha","zeta"}',
            selected_entity_ids: JSON.stringify([entityId, entityId]),
            preferred_region_codes: ['SEOUL', 'BUSAN', 'SEOUL'],
            acted_category_codes: '["policy","housing","policy"]',
          },
        ];
      },
    }),
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const inputs = await repository.findFeedMemberInputs(userId);

  assert.deepEqual(inputs, {
    context: {
      userId,
      selectedCategoryCodes: ['alpha', 'zeta'],
      selectedEntityIds: [entityId],
      preferredRegionCodes: ['BUSAN', 'SEOUL'],
      ageGroup: 'AGE_35_49',
    },
    actedCategoryCodes: ['housing', 'policy'],
  });
  assert.equal(calls.length, 0);
  assert.match(queryText, /from users u/i);
  assert.match(queryText, /user_category_preferences/i);
  assert.match(queryText, /user_entity_preferences/i);
  assert.match(queryText, /user_region_preferences/i);
  assert.match(queryText, /user_interaction_events/i);
  assert.match(queryText, /where u\.id = \$1::uuid/i);
  assert.match(queryText, /weight > 0/i);
  assert.equal(queryText.includes(userId), false);
  assert.deepEqual(queryParams, [userId]);
});

test('통합 회원 피드는 사용자 부재와 빈 배열을 null·빈 목록으로 정규화한다', async () => {
  const userId = '00000000-0000-0000-0000-000000000043';
  const missingRepository = new IssueCardQueryRepository(
    fakeEntityManager({
      getConnection: () => ({ execute: async () => [] }),
    }).entityManager,
  );
  assert.deepEqual(await missingRepository.findFeedMemberInputs(userId), {
    context: null,
    actedCategoryCodes: [],
  });

  const emptyRepository = new IssueCardQueryRepository(
    fakeEntityManager({
      getConnection: () => ({
        execute: async () => [
          {
            user_id: userId,
            age_group: null,
            selected_category_codes: '{}',
            selected_entity_ids: '{}',
            preferred_region_codes: null,
            acted_category_codes: '[]',
          },
        ],
      }),
    }).entityManager,
  );
  assert.deepEqual(await emptyRepository.findFeedMemberInputs(userId), {
    context: {
      userId,
      selectedCategoryCodes: [],
      selectedEntityIds: [],
      preferredRegionCodes: [],
      ageGroup: null,
    },
    actedCategoryCodes: [],
  });
});

test('회원 행동 분류는 사용자 ID 서브쿼리와 최소 projection만 사용한다', async () => {
  const userId = '00000000-0000-7000-8000-000000000041';
  const queryCalls: { select?: unknown; where?: unknown } = {};
  const fieldsByEntity = new Map<unknown, unknown>();
  const interactionQuery: FakeQueryBuilder = {
    __subquery: true,
    select: (fields) => {
      queryCalls.select = fields;
      return interactionQuery;
    },
    where: (where) => {
      queryCalls.where = where;
      return interactionQuery;
    },
    andWhere: () => interactionQuery,
    distinctOn: () => interactionQuery,
    orderBy: () => interactionQuery,
    getResultList: async () => [],
  };
  const { entityManager } = fakeEntityManager({
    createQueryBuilder: (entity, alias) => {
      assert.equal(entity, IssueQueryInteractionEntity);
      assert.equal(alias, 'event');
      return interactionQuery;
    },
    find: async (entity, where, options) => {
      fieldsByEntity.set(entity, options);
      assert.equal(entity, IssueQueryIssueEntity);
      assert.deepEqual(where, { id: { $in: interactionQuery } });
      return [
        { id: ISSUE_ID, categoryCode: 'housing' },
        { id: '00000000-0000-7000-8000-000000000042', categoryCode: 'policy' },
      ];
    },
  });
  const repository = new IssueCardQueryRepository(entityManager);

  assert.deepEqual(await repository.findActedCategoryCodes(userId), ['housing', 'policy']);
  assert.equal(queryCalls.select, 'event.issueId');
  assert.deepEqual(queryCalls.where, { userId });
  assert.deepEqual((fieldsByEntity.get(IssueQueryIssueEntity) as { fields: string[] }).fields, [
    'id',
    'categoryCode',
  ]);
});

test('회원 후보 SQL은 interaction 목록 없이 모든 후보 slice에 NOT EXISTS를 적용한다', async () => {
  const userId = '00000000-0000-7000-8000-000000000043';
  const interactionPredicates: Array<{ sql: string; params: readonly unknown[] }> = [];
  const { entityManager } = fakeEntityManager({
    getConnection: () => ({}),
    createQueryBuilder: (entity) => {
      const query: FakeQueryBuilder = {
        __subquery: true,
        select: () => query,
        where: () => query,
        andWhere: (condition) => {
          if (isRawQueryFragment(condition)) {
            interactionPredicates.push({ sql: condition.sql, params: condition.params });
          }
          return query;
        },
        distinctOn: () => query,
        orderBy: () => query,
        limit: () => query,
        execute: async () => [],
        getResultList: async () => [],
      };
      void entity;
      return query;
    },
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const scope: IssueCandidateScope = {
    memberUserId: userId,
    highScoreThreshold: 0.8,
    selectedCategoryCodes: [],
    selectedEntityIds: [],
    preferredRegionCodes: [],
    ageGroup: null,
    actedCategoryCodes: [],
    connectedIssueIds: [],
  };
  await repository.findCandidates(new Set(), 2, scope);

  const exclusionPredicates = interactionPredicates.filter((predicate) =>
    /not exists/i.test(predicate.sql),
  );
  assert.ok(exclusionPredicates.length >= 3);
  for (const predicate of exclusionPredicates) {
    assert.match(predicate.sql, /not exists/i);
    assert.match(predicate.sql, /user_interaction_events/i);
    assert.deepEqual(predicate.params, [userId]);
  }
});

test('연결 후보 여부는 후보를 선별한 같은 SQL projection에서 계산한다', async () => {
  const userId = '00000000-0000-7000-8000-000000000044';
  const targetId = '00000000-0000-7000-8000-000000000045';
  const target = issuePersistenceRow(targetId);
  const selectedProjections: unknown[] = [];
  const selectedPredicates: Array<{ sql: string; params: readonly unknown[] }> = [];
  let candidateExecuteCalls = 0;
  const { entityManager } = fakeEntityManager({
    createQueryBuilder: () => {
      const query: FakeQueryBuilder = {
        __subquery: true,
        select: (fields) => {
          selectedProjections.push(fields);
          return query;
        },
        where: () => query,
        andWhere: (condition) => {
          if (isRawQueryFragment(condition)) {
            selectedPredicates.push({ sql: condition.sql, params: condition.params });
          }
          return query;
        },
        distinctOn: () => query,
        orderBy: () => query,
        limit: () => query,
        execute: async () => {
          candidateExecuteCalls += 1;
          return candidateExecuteCalls === 1 ? [] : [{ id: targetId, connected: true }];
        },
        getResultList: async () => [],
      };
      return query;
    },
    find: async (entity) => (entity === IssueQueryIssueEntity ? [target] : []),
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const candidates = await repository.findFeedCandidates(new Set(), 1, {
    memberUserId: userId,
    highScoreThreshold: 0.8,
    selectedCategoryCodes: [],
    selectedEntityIds: [],
    preferredRegionCodes: [],
    ageGroup: null,
    actedCategoryCodes: [],
    connectedIssueIds: [],
  });

  assert.equal(candidates[0]?.connected, true);
  assert.equal(candidateExecuteCalls, 2);
  const rawProjections = selectedProjections
    .flatMap((fields) => (Array.isArray(fields) ? fields : []))
    .filter(isRawQueryFragment);
  const connectedProjection = rawProjections.find((projection) =>
    /case when/i.test(projection.sql),
  );
  const connectedSliceProjection = rawProjections.find((projection) =>
    /true as/i.test(projection.sql),
  );
  assert.ok(connectedProjection);
  assert.ok(connectedSliceProjection);
  assert.match(connectedProjection.sql, /case when/i);
  assert.match(connectedProjection.sql, /user_interaction_events/i);
  assert.match(connectedProjection.sql, /select distinct relation\.to_issue_id/i);
  assert.match(connectedProjection.sql, /select distinct on \(interaction\.issue_id\)/i);
  assert.match(
    connectedProjection.sql,
    /order by interaction\.issue_id, interaction\.accepted_order desc, interaction\.id desc/i,
  );
  assert.match(
    connectedProjection.sql,
    /join issue_relations relation\s+on relation\.from_issue_id = latest_interaction\.issue_id/i,
  );
  assert.match(connectedProjection.sql, /latest_interaction\.event_type = 'LIKE'/i);
  assert.doesNotMatch(connectedProjection.sql, /relation\.to_issue_id\s*=\s*issue\.id/i);
  const derivedSetEnd = connectedProjection.sql.indexOf(') latest_interaction');
  const outerLikeFilter = connectedProjection.sql.indexOf("latest_interaction.event_type = 'LIKE'");
  assert.ok(derivedSetEnd >= 0);
  assert.ok(outerLikeFilter > derivedSetEnd);
  assert.equal(
    connectedProjection.sql.slice(0, derivedSetEnd).includes("event_type = 'LIKE'"),
    false,
  );
  assert.equal(connectedProjection.params[0], userId);

  const connectedPredicate = selectedPredicates.find((predicate) =>
    /select distinct relation\.to_issue_id/i.test(predicate.sql),
  );
  assert.ok(connectedPredicate);
  assert.deepEqual(connectedPredicate.params, [userId]);
  const projectedPredicate = connectedProjection.sql
    .replace(/^case when /i, '')
    .replace(/ then true else false end(?: as .*)?$/i, '');
  assert.equal(connectedPredicate.sql.replace(/\[::alias::\]/g, 'issue'), projectedPredicate);
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

  assert.equal(flushCount(), 2);
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

test('latest interactions are selected by PostgreSQL query builder and follow-ups use EntityManager', async () => {
  const interactionRows: IssueQueryInteractionPersistenceEntity[] = [
    {
      id: '00000000-0000-7000-8000-000000000040',
      userId: '00000000-0000-7000-8000-000000000041',
      issueId: ISSUE_ID,
      eventType: 'LIKE',
      acceptedOrder: 2,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    {
      id: '00000000-0000-7000-8000-000000000042',
      userId: '00000000-0000-7000-8000-000000000041',
      issueId: ISSUE_ID,
      eventType: 'SKIP',
      acceptedOrder: 1,
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
  const queryCalls: {
    select?: string | readonly string[];
    where?: unknown;
    distinctOn?: string;
    orderBy?: unknown;
  } = {};
  const interactionQuery: FakeQueryBuilder = {
    __subquery: true,
    select: (fields) => {
      queryCalls.select = fields;
      return interactionQuery;
    },
    where: (where) => {
      queryCalls.where = where;
      return interactionQuery;
    },
    andWhere: () => interactionQuery,
    distinctOn: (fields) => {
      queryCalls.distinctOn = fields;
      return interactionQuery;
    },
    orderBy: (orderBy) => {
      queryCalls.orderBy = orderBy;
      return interactionQuery;
    },
    getResultList: async () => [interactionRows[0]!],
  };
  const { entityManager, calls } = fakeEntityManager({
    createQueryBuilder: (entity, alias) => {
      assert.equal(entity, IssueQueryInteractionEntity);
      assert.equal(alias, 'event');
      return interactionQuery;
    },
    find: async (entity) => (entity === IssueQueryRelationEntity ? [relation] : []),
  });
  const repository = new IssueCardQueryRepository(entityManager);

  const interactions = await repository.findLatestInteractions(interactionRows[0]!.userId);
  const followUps = await repository.findFollowUps(new Set([ISSUE_ID]));

  assert.deepEqual(interactions, [
    {
      id: interactionRows[0]!.id,
      userId: interactionRows[0]!.userId,
      issueId: interactionRows[0]!.issueId,
      eventType: 'LIKE',
      createdAt: interactionRows[0]!.createdAt,
    },
  ]);
  assert.deepEqual(queryCalls.select, [
    'event.id',
    'event.userId',
    'event.issueId',
    'event.eventType',
    'event.acceptedOrder',
    'event.createdAt',
  ]);
  assert.deepEqual(queryCalls.where, { userId: interactionRows[0]!.userId });
  assert.equal(queryCalls.distinctOn, 'event.issueId');
  assert.deepEqual(queryCalls.orderBy, {
    issueId: QueryOrder.ASC,
    acceptedOrder: QueryOrder.DESC,
    id: QueryOrder.DESC,
  });
  assert.equal(calls.includes('find:IssueQueryInteraction'), false);
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
  getConnection?: () => unknown;
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
  select: (field: string | readonly string[]) => FakeQueryBuilder;
  where: (where: unknown) => FakeQueryBuilder;
  andWhere: (where: unknown) => FakeQueryBuilder;
  distinctOn: (fields: string) => FakeQueryBuilder;
  orderBy: (orderBy: unknown) => FakeQueryBuilder;
  limit?: (limit: number) => FakeQueryBuilder;
  execute?: (...args: unknown[]) => Promise<unknown[]>;
  getResultList: () => Promise<unknown[]>;
}

interface FakeEntityManagerOptions {
  getConnection?: FakeEntityManager['getConnection'];
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
    getConnection: options.getConnection,
    createQueryBuilder:
      options.createQueryBuilder ??
      ((entity, alias) => {
        const query: FakeQueryBuilder = {
          __subquery: true,
          select: () => query,
          where: () => query,
          andWhere: () => query,
          distinctOn: () => query,
          orderBy: () => query,
          getResultList: async () => [],
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

function isRawQueryFragment(value: unknown): value is { sql: string; params: readonly unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sql' in value &&
    typeof value.sql === 'string' &&
    'params' in value &&
    Array.isArray(value.params)
  );
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
  if (entity === UserSchema) return 'User';
  if (entity === UserCategoryPreferenceSchema) return 'UserCategoryPreference';
  if (entity === UserEntityPreferenceSchema) return 'UserEntityPreference';
  if (entity === UserRegionPreferenceSchema) return 'UserRegionPreference';
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
    mainTopic: null,
    representativeEntityId: null,
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
    guestTokenHash: null,
    algorithmVersion: 'issue-card-query-v1',
    candidateBudget: 500,
    highScoreThreshold: 0.8,
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
    owner: { kind: 'MEMBER', userId: '00000000-0000-0000-0000-000000000001' },
    algorithmVersion: 'issue-card-query-v1',
    candidateBudget: 500,
    highScoreThreshold: 0.8,
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
