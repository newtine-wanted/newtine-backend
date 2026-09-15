import { EntityManager, LockMode, raw, type FilterQuery, type Subquery } from '@mikro-orm/core';
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql';
import type { QBFilterQuery } from '@mikro-orm/sql';
import { Injectable } from '@nestjs/common';

import {
  generateUuidV7,
  IssueException,
  IssueExceptionCode,
  type FeedBatchRecord,
  type FeedOwner,
  type FeedSessionRecord,
  type IssueCandidateScope,
  type IssueGlossaryRecord,
  type IssueImpactRecord,
  type IssueQueryRepository,
  type IssueRecord,
  type IssueRelationRecord,
  type UserInteractionRecord,
  type UserRecommendationContext,
} from '@newtine/core';
import type { AgeGroup } from '@newtine/core/issue/repository/type/issueQuery.repository.js';
import {
  FeedBatchEntity,
  FeedBatchItemEntity,
  FeedSessionEntity,
  IssueQueryArticleEntity,
  IssueQueryArticleLinkEntity,
  IssueQueryDetailEntity,
  IssueQueryEntityLinkEntity,
  IssueQueryInteractionEntity,
  IssueQueryIssueEntity,
  IssueQueryImpactEntity,
  IssueQueryPublisherEntity,
  IssueQueryRelationEntity,
  type FeedBatchPersistenceEntity,
  type FeedSessionPersistenceEntity,
  type IssueQueryArticleLinkPersistenceEntity,
  type IssueQueryArticlePersistenceEntity,
  type IssueQueryDetailPersistenceEntity,
  type IssueQueryEntityLinkPersistenceEntity,
  type IssueQueryInteractionPersistenceEntity,
  type IssueQueryIssuePersistenceEntity,
  type IssueQueryImpactPersistenceEntity,
} from '@newtine/core/issue/persistence/issueQuery.persistence.entity.js';
import {
  IssueCategorySchema,
  UserCategoryPreferenceSchema,
  UserEntityPreferenceSchema,
  UserRegionPreferenceSchema,
  UserSchema,
} from '@newtine/core/onboarding/persistence/onboarding.persistence.entity.js';

/**
 * Production issue-card adapter.
 *
 * The application module binds this adapter unconditionally. Test doubles live
 * under test/fixtures and are never part of the production module graph.
 * Schema evolution remains the responsibility of the migrations; this adapter
 * only uses MikroORM's registered EntityManager metadata at runtime.
 */
@Injectable()
export class IssueCardQueryRepository implements IssueQueryRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async createFeedSession(owner: FeedOwner, now: Date): Promise<FeedSessionRecord> {
    const session: FeedSessionRecord = {
      id: generateUuidV7(),
      owner: { ...owner },
      algorithmVersion: 'issue-card-query-v1',
      nextBatchNo: 0,
      status: 'ACTIVE',
      createdAt: new Date(now),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    };
    const manager = this.currentEntityManager();
    manager.persist(
      manager.create(FeedSessionEntity, {
        id: session.id,
        userId: owner.userId,
        algorithmVersion: session.algorithmVersion,
        nextBatchNo: session.nextBatchNo,
        status: session.status,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastTopic: session.lastTopic,
        lastRepresentativeEntityId: session.lastRepresentativeEntityId,
        topicRun: session.topicRun,
        entityRun: session.entityRun,
      }),
    );
    await manager.flush();
    return session;
  }

  async findFeedSession(
    id: string,
    owner: FeedOwner,
    _now: Date,
  ): Promise<FeedSessionRecord | null> {
    void _now;
    const manager = this.currentEntityManager();
    const row = await manager.findOne(FeedSessionEntity, { id, userId: owner.userId });
    return row === null ? null : toSession(row, owner);
  }

  async findFeedBatch(sessionId: string, batchNo: number): Promise<FeedBatchRecord | null> {
    const manager = this.currentEntityManager();
    const row = await manager.findOne(FeedBatchEntity, { feedSessionId: sessionId, batchNo });
    return row === null ? null : ((await this.loadBatches([row]))[0] ?? null);
  }

  async findFeedBatches(sessionId: string): Promise<FeedBatchRecord[]> {
    const manager = this.currentEntityManager();
    const rows = await manager.find(
      FeedBatchEntity,
      { feedSessionId: sessionId },
      { orderBy: { batchNo: 'ASC' } },
    );
    return this.loadBatches(rows);
  }

  async saveFeedBatch(session: FeedSessionRecord, batch: FeedBatchRecord): Promise<void> {
    const manager = this.currentEntityManager();
    if (!manager.isInTransaction()) {
      throw new Error('feed batch transaction context is unavailable');
    }

    const currentSession = await manager.findOne(
      FeedSessionEntity,
      { id: session.id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (currentSession === null) {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '현재 탐색 상태에서는 새 묶음을 저장할 수 없습니다.',
      );
    }
    const unexpiredSessionCount = await manager.count(FeedSessionEntity, {
      id: session.id,
      expiresAt: { $gt: raw('clock_timestamp()') },
    });
    if (unexpiredSessionCount === 0) {
      throw new IssueException(
        IssueExceptionCode.FeedSessionExpired,
        '탐색 세션이 만료되었습니다.',
      );
    }

    const existing = await manager.findOne(FeedBatchEntity, {
      feedSessionId: batch.sessionId,
      batchNo: batch.batchNo,
    });
    if (existing !== null) return;

    const latest = await manager.findOne(
      FeedBatchEntity,
      { feedSessionId: batch.sessionId },
      { orderBy: { batchNo: 'DESC' } },
    );
    if (
      currentSession.status === 'COMPLETED' ||
      currentSession.nextBatchNo !== batch.batchNo ||
      (latest !== null && latest.continuation !== 'CONTINUE')
    ) {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '현재 탐색 상태에서는 새 묶음을 저장할 수 없습니다.',
      );
    }

    manager.persist(
      manager.create(FeedBatchEntity, {
        feedSessionId: batch.sessionId,
        batchNo: batch.batchNo,
        continuation: batch.continuation,
        createdAt: batch.createdAt,
      }),
    );
    for (const item of batch.items) {
      manager.persist(
        manager.create(FeedBatchItemEntity, {
          feedSessionId: batch.sessionId,
          batchNo: batch.batchNo,
          position: item.position,
          issueId: item.issueId,
          selectionType: item.selectionType,
          reasonCodes: [...item.reasonCodes],
        }),
      );
    }

    currentSession.nextBatchNo = session.nextBatchNo;
    currentSession.status = session.status;
    currentSession.lastTopic = session.lastTopic;
    currentSession.lastRepresentativeEntityId = session.lastRepresentativeEntityId;
    currentSession.topicRun = session.topicRun;
    currentSession.entityRun = session.entityRun;
    manager.persist(currentSession);
    await manager.flush();
  }

  async findCandidates(
    excludedIssueIds: ReadonlySet<string>,
    limit?: number,
    scope?: IssueCandidateScope,
  ): Promise<IssueRecord[]> {
    const candidateLimit = limit === undefined ? undefined : normalizeLimit(limit);
    if (candidateLimit === 0) return [];

    const manager = this.currentSqlEntityManager();
    const publicIssueIds = publicIssueDetailIds(manager);
    const baseWhere = candidateWhere(publicIssueIds, excludedIssueIds);
    if (scope === undefined || candidateLimit === undefined) {
      const rows = await manager.find(IssueQueryIssueEntity, baseWhere, {
        orderBy: ISSUE_ORDER_BY,
        ...(candidateLimit === undefined ? {} : { limit: candidateLimit }),
      });
      const orderedIssueIds = rows.map((row) => row.id);
      const issues = await this.loadIssueRecords(new Set(orderedIssueIds), false, orderedIssueIds);
      return issues.filter(isPublicIssue).slice(0, candidateLimit);
    }

    const issueIds: string[] = [];
    const seenIds = new Set(excludedIssueIds);
    let remainingRows = candidateLimit;
    for (const slice of buildCandidateSlices(manager, scope)) {
      if (remainingRows === 0) break;
      const sliceLimit = Math.min(
        remainingRows,
        Math.max(1, Math.floor(candidateLimit * slice.weight)),
      );
      const rows = await manager.find(
        IssueQueryIssueEntity,
        combineIssueFilters(baseWhere, slice.where),
        { orderBy: ISSUE_ORDER_BY, limit: sliceLimit },
      );
      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        issueIds.push(row.id);
        remainingRows -= 1;
        if (remainingRows === 0) break;
      }
    }
    if (remainingRows > 0) {
      const rows = await manager.find(
        IssueQueryIssueEntity,
        candidateWhere(publicIssueIds, seenIds),
        { orderBy: ISSUE_ORDER_BY, limit: remainingRows },
      );
      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        issueIds.push(row.id);
        remainingRows -= 1;
        if (remainingRows === 0) break;
      }
    }
    const issues = await this.loadIssueRecords(new Set(issueIds), false, issueIds);
    return issues.filter(isPublicIssue).slice(0, candidateLimit);
  }

  async findIssue(id: string): Promise<IssueRecord | null> {
    const issues = await this.loadIssueRecords(new Set([id]), true);
    return issues[0] ?? null;
  }

  async findIssuesByIds(ids: ReadonlySet<string>): Promise<IssueRecord[]> {
    if (ids.size === 0) return [];
    return this.loadIssueRecords(ids, false);
  }

  async findUserContext(userId: string): Promise<UserRecommendationContext | null> {
    const manager = this.currentEntityManager();
    const user = await manager.findOne(UserSchema, { id: userId });
    if (user === null) return null;
    const [categoryPreferences, entityPreferences, regionPreferences] = await Promise.all([
      manager.find(
        UserCategoryPreferenceSchema,
        { userId, weight: { $gt: 0 } },
        { orderBy: { categoryCode: 'ASC' } },
      ),
      manager.find(
        UserEntityPreferenceSchema,
        { userId, weight: { $gt: 0 } },
        { orderBy: { entityId: 'ASC' } },
      ),
      manager.find(
        UserRegionPreferenceSchema,
        { userId, weight: { $gt: 0 } },
        { orderBy: { regionCode: 'ASC' } },
      ),
    ]);
    return {
      userId: String(user.id),
      selectedCategoryCodes: activePreferenceValues(categoryPreferences, 'categoryCode'),
      selectedEntityIds: activePreferenceValues(entityPreferences, 'entityId'),
      preferredRegionCodes: activePreferenceValues(regionPreferences, 'regionCode'),
      ageGroup: ageGroupValue(user.ageGroup),
    };
  }

  async findLatestInteractions(userId: string): Promise<UserInteractionRecord[]> {
    const manager = this.currentEntityManager();
    const rows = await manager.find(
      IssueQueryInteractionEntity,
      { userId },
      { orderBy: { issueId: 'ASC', createdAt: 'DESC', id: 'DESC' } },
    );
    const latestByIssue = new Map<string, IssueQueryInteractionPersistenceEntity>();
    for (const row of rows) {
      if (!latestByIssue.has(row.issueId)) latestByIssue.set(row.issueId, row);
    }
    return [...latestByIssue.values()].map((row) => ({
      id: row.id,
      userId: row.userId,
      issueId: row.issueId,
      eventType: eventTypeValue(row.eventType),
      createdAt: dateValue(row.createdAt),
    }));
  }

  async findFollowUps(issueIds: ReadonlySet<string>): Promise<IssueRelationRecord[]> {
    if (issueIds.size === 0) return [];
    const manager = this.currentEntityManager();
    const rows = await manager.find(
      IssueQueryRelationEntity,
      { fromIssueId: { $in: [...issueIds] }, relationType: 'FOLLOW_UP' },
      { orderBy: { fromIssueId: 'ASC', verifiedAt: 'ASC', toIssueId: 'ASC' } },
    );
    return rows
      .filter((row) => row.verifiedAt !== null && row.verifiedAt !== undefined)
      .map((row) => ({
        fromIssueId: row.fromIssueId,
        toIssueId: row.toIssueId,
        relationType: 'FOLLOW_UP',
        verifiedAt: dateValue(row.verifiedAt),
      }));
  }

  private async loadIssueRecords(
    issueIds: ReadonlySet<string> | undefined,
    includeArticles: boolean,
    orderedIssueIds?: readonly string[],
  ): Promise<IssueRecord[]> {
    const manager = this.currentEntityManager();
    const issueWhere = issueIds === undefined ? {} : { id: { $in: [...issueIds] } };
    const issueRows = await manager.find(IssueQueryIssueEntity, issueWhere);
    if (issueRows.length === 0) return [];

    const selectedIssueIds = new Set(issueRows.map((row) => row.id));
    const categoryCodes = [...new Set(issueRows.map((row) => row.categoryCode))];
    const [categories, details, impacts, entityLinks, articleLinks] = await Promise.all([
      manager.find(IssueCategorySchema, { code: { $in: categoryCodes } }),
      manager.find(IssueQueryDetailEntity, { issueId: { $in: [...selectedIssueIds] } }),
      manager.find(IssueQueryImpactEntity, { issueId: { $in: [...selectedIssueIds] } }),
      manager.find(IssueQueryEntityLinkEntity, { issueId: { $in: [...selectedIssueIds] } }),
      manager.find(IssueQueryArticleLinkEntity, { issueId: { $in: [...selectedIssueIds] } }),
    ]);

    const articleIds = [...new Set(articleLinks.map((row) => row.articleId))];
    const articles =
      articleIds.length === 0
        ? []
        : await manager.find(IssueQueryArticleEntity, { id: { $in: articleIds } });
    const publisherIds = [
      ...new Set(
        articles
          .map((article) => article.publisherId)
          .filter((publisherId): publisherId is string => publisherId !== null),
      ),
    ];
    const publishers =
      publisherIds.length === 0
        ? []
        : await manager.find(IssueQueryPublisherEntity, { id: { $in: publisherIds } });

    const categoryByCode = new Map(
      categories.map((category) => [String(category.code), String(category.displayName)]),
    );
    const detailsByIssue = new Map(details.map((detail) => [detail.issueId, detail]));
    const impactsByIssue = groupBy(impacts, (row) => row.issueId);
    const entityIdsByIssue = groupBy(entityLinks, (row) => row.issueId);
    const articleLinksByIssue = groupBy(articleLinks, (row) => row.issueId);
    const articlesById = new Map(articles.map((article) => [article.id, article]));
    const publisherById = new Map(publishers.map((publisher) => [publisher.id, publisher]));

    const issues = issueRows.map((row) => {
      const issueImpacts = (impactsByIssue.get(row.id) ?? [])
        .map(toImpact)
        .filter((impact): impact is IssueImpactRecord => impact !== null);
      const availableArticles = (articleLinksByIssue.get(row.id) ?? [])
        .sort(compareArticleLink)
        .map((link) => articlesById.get(link.articleId))
        .filter(
          (article): article is IssueQueryArticlePersistenceEntity =>
            article !== undefined && article.sourceStatus === 'AVAILABLE',
        );
      const issue = toIssue(
        row,
        categoryByCode.get(row.categoryCode) ?? row.categoryCode,
        detailsByIssue.get(row.id),
        issueImpacts,
        entityIdsByIssue.get(row.id) ?? [],
        availableArticles.length,
      );
      if (includeArticles) {
        issue.articles = availableArticles.map((article) => ({
          id: article.id,
          title: article.title,
          url: article.articleUrl,
          publisherName:
            (article.publisherId === null
              ? undefined
              : publisherById.get(article.publisherId)?.name) ?? article.publisherName,
          publishedAt: nullableDate(article.publishedAt),
        }));
      }
      return issue;
    });
    if (orderedIssueIds === undefined) return issues;
    const issueById = new Map(issues.map((issue) => [issue.id, issue]));
    return orderedIssueIds.flatMap((issueId) => {
      const issue = issueById.get(issueId);
      return issue === undefined ? [] : [issue];
    });
  }

  private async loadBatches(
    rows: readonly FeedBatchPersistenceEntity[],
  ): Promise<FeedBatchRecord[]> {
    if (rows.length === 0) return [];
    const manager = this.currentEntityManager();
    const sessionId = rows[0]!.feedSessionId;
    const batchNos = rows.map((row) => row.batchNo);
    const itemRows = await manager.find(
      FeedBatchItemEntity,
      { feedSessionId: sessionId, batchNo: { $in: batchNos } },
      { orderBy: { batchNo: 'ASC', position: 'ASC' } },
    );
    const itemsByBatch = new Map<number, FeedBatchRecord['items']>();
    for (const item of itemRows) {
      const items = itemsByBatch.get(item.batchNo) ?? [];
      items.push({
        issueId: item.issueId,
        position: item.position,
        selectionType: selectionTypeValue(item.selectionType),
        reasonCodes: stringArray(item.reasonCodes),
      });
      itemsByBatch.set(item.batchNo, items);
    }
    return rows.map((row) => ({
      sessionId: row.feedSessionId,
      batchNo: row.batchNo,
      continuation: continuationValue(row.continuation),
      createdAt: dateValue(row.createdAt),
      items: itemsByBatch.get(row.batchNo) ?? [],
    }));
  }

  private currentEntityManager(): EntityManager {
    return this.entityManager.getContext(false);
  }

  private currentSqlEntityManager(): PostgreSqlEntityManager {
    return this.entityManager.getContext(false) as PostgreSqlEntityManager;
  }
}

type IssueFilter = FilterQuery<IssueQueryIssuePersistenceEntity>;

interface CandidateSlice {
  where: IssueFilter;
  weight: number;
}

const ISSUE_ORDER_BY = {
  importanceScore: 'DESC',
  freshnessScore: 'DESC',
  eventAt: 'DESC',
  id: 'ASC',
} as const;

function buildCandidateSlices(
  manager: PostgreSqlEntityManager,
  scope: IssueCandidateScope,
): CandidateSlice[] {
  const slices: CandidateSlice[] = [];
  const personalized = personalizedWhere(manager, scope);
  if (personalized !== undefined) slices.push({ where: personalized, weight: 0.3 });

  const threshold = Math.min(1, Math.max(0, scope.highScoreThreshold));
  const major: IssueFilter = {
    $or: [{ importanceScore: { $gte: threshold } }, { freshnessScore: { $gte: threshold } }],
  };
  slices.push({ where: major, weight: 0.2 });

  const connectedIds = uniqueStrings(scope.connectedIssueIds);
  if (connectedIds.length > 0) {
    slices.push({ where: { id: { $in: connectedIds } }, weight: 0.15 });
  }

  const excludedCategories = uniqueStrings([
    ...scope.selectedCategoryCodes,
    ...scope.actedCategoryCodes,
  ]);
  if (excludedCategories.length > 0) {
    slices.push({ where: { categoryCode: { $nin: excludedCategories } }, weight: 0.2 });
  }

  const mismatch = mismatchWhere(manager, scope);
  if (personalized !== undefined && mismatch !== undefined) {
    slices.push({
      where: combineIssueFilters({ $not: personalized }, mismatch, major),
      weight: 0.15,
    });
  }
  return slices;
}

function candidateWhere(
  publicIssueIds: Subquery,
  excludedIssueIds: ReadonlySet<string>,
): IssueFilter {
  return combineIssueFilters(
    {
      publicationStatus: 'PUBLISHED',
      id: { $in: publicIssueIds },
    },
    excludedIssueIds.size === 0 ? undefined : { id: { $nin: [...excludedIssueIds] } },
  );
}

function combineIssueFilters(...filters: (IssueFilter | undefined)[]): IssueFilter {
  const defined = filters.filter((filter): filter is IssueFilter => filter !== undefined);
  if (defined.length === 0) return {};
  if (defined.length === 1) return defined[0]!;
  return { $and: defined };
}

function publicIssueDetailIds(manager: PostgreSqlEntityManager): Subquery {
  const where = {
    integratedSummary: { $ne: null },
    [raw((alias) => `jsonb_typeof(${alias}.summary_lines) = 'array'`)]: [],
    [raw((alias) => `jsonb_array_length(${alias}.summary_lines) = 3`)]: [],
  } as unknown as QBFilterQuery<IssueQueryDetailPersistenceEntity>;
  return manager
    .createQueryBuilder(IssueQueryDetailEntity, 'detail')
    .select('issueId')
    .where(where);
}

function personalizedWhere(
  manager: PostgreSqlEntityManager,
  scope: IssueCandidateScope,
): IssueFilter | undefined {
  const filters: IssueFilter[] = [];
  if (scope.selectedCategoryCodes.length > 0) {
    filters.push({ categoryCode: { $in: scope.selectedCategoryCodes } });
  }
  if (scope.selectedEntityIds.length > 0) {
    filters.push({
      id: { $in: issueIdsByEntity(manager, scope.selectedEntityIds) },
    });
  }
  if (scope.preferredRegionCodes.length > 0) {
    filters.push({
      id: {
        $in: issueIdsByImpact(manager, 'REGION', scope.preferredRegionCodes),
      },
    });
  }
  if (scope.ageGroup !== null) {
    filters.push({
      id: { $in: issueIdsByImpact(manager, 'AGE_GROUP', [scope.ageGroup]) },
    });
  }
  return filters.length === 0 ? undefined : { $or: filters };
}

function mismatchWhere(
  manager: PostgreSqlEntityManager,
  scope: IssueCandidateScope,
): IssueFilter | undefined {
  const filters: IssueFilter[] = [];
  if (scope.selectedCategoryCodes.length > 0) {
    filters.push({ categoryCode: { $nin: scope.selectedCategoryCodes } });
  }
  if (scope.selectedEntityIds.length > 0) {
    filters.push(
      combineIssueFilters(
        { id: { $in: issueIdsByEntity(manager, undefined) } },
        { id: { $nin: issueIdsByEntity(manager, scope.selectedEntityIds) } },
      ),
    );
  }
  if (scope.preferredRegionCodes.length > 0) {
    filters.push(
      combineIssueFilters(
        { id: { $in: issueIdsByImpact(manager, 'REGION', undefined) } },
        { id: { $nin: issueIdsByImpact(manager, 'REGION', scope.preferredRegionCodes) } },
      ),
    );
  }
  if (scope.ageGroup !== null) {
    filters.push(
      combineIssueFilters(
        { id: { $in: issueIdsByImpact(manager, 'AGE_GROUP', undefined) } },
        { id: { $nin: issueIdsByImpact(manager, 'AGE_GROUP', [scope.ageGroup]) } },
      ),
    );
  }
  return filters.length === 0 ? undefined : { $or: filters };
}

function issueIdsByEntity(
  manager: PostgreSqlEntityManager,
  entityIds: readonly string[] | undefined,
): Subquery {
  const query = manager
    .createQueryBuilder(IssueQueryEntityLinkEntity, 'entityLink')
    .select('issueId');
  return entityIds === undefined ? query : query.where({ entityId: { $in: entityIds } });
}

function issueIdsByImpact(
  manager: PostgreSqlEntityManager,
  targetType: 'AGE_GROUP' | 'REGION',
  targetValues: readonly string[] | undefined,
): Subquery {
  const query = manager
    .createQueryBuilder(IssueQueryImpactEntity, 'impact')
    .select('issueId')
    .where({ targetType });
  return targetValues === undefined
    ? query
    : query.andWhere({ targetValue: { $in: targetValues } });
}

function toIssue(
  row: IssueQueryIssuePersistenceEntity,
  categoryName: string,
  detail: IssueQueryDetailPersistenceEntity | undefined,
  impacts: IssueImpactRecord[],
  entityLinks: IssueQueryEntityLinkPersistenceEntity[],
  articleCount: number,
): IssueRecord {
  const regionCodes = uniqueStrings(
    impacts.filter((impact) => impact.targetType === 'REGION').map((impact) => impact.targetValue),
  );
  const ageGroups = impacts
    .filter((impact) => impact.targetType === 'AGE_GROUP')
    .map((impact) => impact.targetValue)
    .filter(isAgeGroup);
  return {
    id: row.id,
    title: row.title,
    categoryCode: row.categoryCode,
    categoryName,
    subCategory: nullableString(row.subCategory),
    mainTopic: nullableString(row.mainTopic),
    representativeEntityId: nullableString(row.representativeEntityId),
    entityIds: uniqueStrings(entityLinks.map((link) => link.entityId)),
    regionCodes,
    ageGroups,
    eventAt: nullableDate(row.eventAt),
    publicationStatus: publicationStatusValue(row.publicationStatus),
    freshnessScore: numberValue(row.freshnessScore),
    importanceScore: numberValue(row.importanceScore),
    publishedAt: nullableDate(row.publishedAt),
    updatedAt: dateValue(row.updatedAt),
    integratedSummary: detail?.integratedSummary ?? null,
    summaryLines: stringArray(detail?.summaryLines),
    viewpoints: viewpointsValue(detail?.viewpoints),
    glossary: glossaryValue(detail?.glossary),
    articles: [],
    articleCount,
    impacts,
  };
}

function toSession(row: FeedSessionPersistenceEntity, owner: FeedOwner): FeedSessionRecord {
  return {
    id: row.id,
    owner: { ...owner },
    algorithmVersion: row.algorithmVersion,
    nextBatchNo: row.nextBatchNo,
    status: row.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
    createdAt: dateValue(row.createdAt),
    expiresAt: dateValue(row.expiresAt),
    lastTopic: nullableString(row.lastTopic),
    lastRepresentativeEntityId: nullableString(row.lastRepresentativeEntityId),
    topicRun: row.topicRun,
    entityRun: row.entityRun,
  };
}

function toImpact(row: IssueQueryImpactPersistenceEntity): IssueImpactRecord | null {
  const targetType = impactTypeValue(row.targetType);
  return targetType === null
    ? null
    : {
        targetType,
        targetValue: row.targetValue,
        description: row.description,
        timing: null,
        action: null,
      };
}

function compareArticleLink(
  left: IssueQueryArticleLinkPersistenceEntity,
  right: IssueQueryArticleLinkPersistenceEntity,
): number {
  if (left.sortOrder === null && right.sortOrder !== null) return 1;
  if (left.sortOrder !== null && right.sortOrder === null) return -1;
  if (left.sortOrder !== right.sortOrder) {
    return numberValue(left.sortOrder) - numberValue(right.sortOrder);
  }
  return left.articleId.localeCompare(right.articleId);
}

function isPublicIssue(issue: IssueRecord): boolean {
  return (
    issue.publicationStatus === 'PUBLISHED' &&
    issue.integratedSummary !== null &&
    issue.summaryLines.length === 3
  );
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return grouped;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}

function activePreferenceValues(rows: readonly unknown[], property: string): string[] {
  return uniqueStrings(
    rows
      .filter(isRecord)
      .filter((row) => numberValue(row.weight) > 0)
      .map((row) => stringValue(row[property])),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function nullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : dateValue(value);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed))
        return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return value.startsWith('{') && value.endsWith('}')
        ? value
            .slice(1, -1)
            .split(',')
            .filter(Boolean)
            .map((item) => item.replace(/^"|"$/g, ''))
        : [];
    }
  }
  return [];
}

function viewpointsValue(value: unknown): IssueRecord['viewpoints'] {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return viewpointsValue(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((item) => ({
    statement: stringValue(item.statement),
    articleIds: stringArray(item.article_ids ?? item.articleIds),
  }));
}

function glossaryValue(value: unknown): IssueGlossaryRecord[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    try {
      return glossaryValue(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    term: stringValue(item.term),
    definition: stringValue(item.definition),
    articleIds: stringArray(item.article_ids ?? item.articleIds),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAgeGroup(value: string): value is AgeGroup {
  return (
    value === 'AGE_19_34' ||
    value === 'AGE_35_49' ||
    value === 'AGE_50_64' ||
    value === 'AGE_65_PLUS'
  );
}

function ageGroupValue(value: unknown): AgeGroup | null {
  return typeof value === 'string' && isAgeGroup(value) ? value : null;
}

function eventTypeValue(value: unknown): UserInteractionRecord['eventType'] {
  return value === 'LIKE' || value === 'SKIP' || value === 'PASS' ? value : 'PASS';
}

function publicationStatusValue(value: unknown): IssueRecord['publicationStatus'] {
  return value === 'UNPUBLISHED' || value === 'PUBLISHED' || value === 'WITHDRAWN'
    ? value
    : 'UNPUBLISHED';
}

function impactTypeValue(value: unknown): IssueImpactRecord['targetType'] | null {
  return value === 'REGION' || value === 'AGE_GROUP' ? value : null;
}

function selectionTypeValue(value: unknown): FeedBatchRecord['items'][number]['selectionType'] {
  return value === 'MAJOR' ||
    value === 'CONNECTED' ||
    value === 'EXPLORATION' ||
    value === 'OPPOSITE'
    ? value
    : 'PERSONALIZED';
}

function continuationValue(value: unknown): FeedBatchRecord['continuation'] {
  return value === 'EXHAUSTED' || value === 'CONSTRAINT_LIMITED' || value === 'SEARCH_LIMITED'
    ? value
    : 'CONTINUE';
}
