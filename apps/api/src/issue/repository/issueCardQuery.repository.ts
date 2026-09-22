import {
  EntityManager,
  LockMode,
  QueryOrder,
  raw,
  sql,
  type FilterQuery,
  type Subquery,
} from '@mikro-orm/core';
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql';
import type { QBFilterQuery } from '@mikro-orm/sql';
import { Injectable } from '@nestjs/common';

import {
  generateUuidV7,
  AuthException,
  AuthExceptionCode,
  IssueException,
  IssueExceptionCode,
  type FeedBatchRecord,
  type FeedBatchSaveOutcome,
  type FeedAlgorithmSnapshot,
  type FeedCardProjection,
  type FeedMemberInputs,
  type FeedRecommendationIssue,
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
import { executePostgresSql } from '@newtine/core/common/database/postgresSql.js';
import type { AgeGroup } from '@newtine/core/issue/repository/type/issueQuery.repository.js';
import { ISSUE_RECOMMENDATION_ALGORITHM_VERSION } from '../recommendation/issueRecommendation.js';
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

  async createFeedSession(
    owner: FeedOwner,
    now: Date,
    algorithm: FeedAlgorithmSnapshot,
  ): Promise<FeedSessionRecord> {
    const session: FeedSessionRecord = {
      id: generateUuidV7(),
      owner: { ...owner },
      algorithmVersion: algorithm.algorithmVersion ?? ISSUE_RECOMMENDATION_ALGORITHM_VERSION,
      candidateBudget: algorithm.candidateBudget,
      highScoreThreshold: algorithm.highScoreThreshold,
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
    if (owner.kind === 'MEMBER') {
      if (!manager.isInTransaction()) {
        throw new Error('member feed session creation requires a transaction');
      }
      const userRows = await executePostgresSql<{ id: string }[]>(
        manager,
        'SELECT id::text AS id FROM users WHERE id = $1::uuid FOR KEY SHARE',
        [owner.userId],
      );
      if (userRows.length !== 1) {
        throw new AuthException(AuthExceptionCode.InvalidCredentials, '인증이 필요합니다.');
      }
    }
    manager.persist(
      manager.create(FeedSessionEntity, {
        id: session.id,
        userId: owner.kind === 'MEMBER' ? owner.userId : null,
        guestTokenHash: owner.kind === 'GUEST' ? owner.guestTokenHash : null,
        algorithmVersion: session.algorithmVersion,
        candidateBudget: session.candidateBudget,
        highScoreThreshold: session.highScoreThreshold,
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
    const row = await manager.findOne(FeedSessionEntity, {
      id,
      ...feedOwnerWhere(owner),
    });
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

  async saveFeedBatch(
    session: FeedSessionRecord,
    batch: FeedBatchRecord,
  ): Promise<FeedBatchSaveOutcome> {
    const manager = this.currentEntityManager();
    if (!manager.isInTransaction()) {
      throw new Error('feed batch transaction context is unavailable');
    }

    const currentSession = await manager.findOne(
      FeedSessionEntity,
      { id: session.id, ...feedOwnerWhere(session.owner) },
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
    if (existing !== null) {
      const canonicalBatch = (await this.loadBatches([existing]))[0];
      if (canonicalBatch === undefined) {
        throw new IssueException(
          IssueExceptionCode.FeedBatchConflict,
          '저장된 탐색 묶음을 다시 읽을 수 없습니다.',
        );
      }
      return { status: 'EXISTING', batch: canonicalBatch };
    }

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
    // FeedBatchItem has a composite FK to its parent. MikroORM may batch
    // unrelated EntitySchema instances in an order that is not FK-safe, so
    // make the parent visible inside this transaction before persisting items.
    await manager.flush();
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

    currentSession.nextBatchNo = batch.batchNo + 1;
    currentSession.status = session.status;
    currentSession.lastTopic = session.lastTopic;
    currentSession.lastRepresentativeEntityId = session.lastRepresentativeEntityId;
    currentSession.topicRun = session.topicRun;
    currentSession.entityRun = session.entityRun;
    manager.persist(currentSession);
    await manager.flush();
    return { status: 'SAVED', batch };
  }

  async findCandidates(
    excludedIssueIds: ReadonlySet<string>,
    limit?: number,
    scope?: IssueCandidateScope,
  ): Promise<IssueRecord[]> {
    const manager = this.currentSqlEntityManager();
    const candidateSelection = await this.findCandidateIssueIds(
      manager,
      excludedIssueIds,
      limit,
      scope,
    );
    const issues = await this.loadIssueRecords(
      new Set(candidateSelection.issueIds),
      'feed',
      candidateSelection.issueIds,
    );
    const candidateLimit = limit === undefined ? undefined : normalizeLimit(limit);
    return issues.filter(isPublicIssue).slice(0, candidateLimit);
  }

  async findFeedCandidates(
    excludedIssueIds: ReadonlySet<string>,
    limit: number,
    scope?: IssueCandidateScope,
  ): Promise<FeedRecommendationIssue[]> {
    const candidateLimit = normalizeLimit(limit);
    if (candidateLimit === 0) return [];
    const manager = this.currentSqlEntityManager();
    const candidateSelection = await this.findCandidateIssueIds(
      manager,
      excludedIssueIds,
      candidateLimit,
      scope,
    );
    const connectedIssueIds =
      scope?.memberUserId === undefined
        ? new Set(scope?.connectedIssueIds ?? [])
        : candidateSelection.connectedIssueIds;
    return this.loadFeedRecommendationIssues(
      new Set(candidateSelection.issueIds),
      candidateSelection.issueIds,
      connectedIssueIds,
    );
  }

  async findFeedCards(ids: ReadonlySet<string>): Promise<FeedCardProjection[]> {
    return this.loadFeedCardProjections(ids);
  }

  async findFeedMemberInputs(userId: string): Promise<FeedMemberInputs> {
    const rows = await executePostgresSql<FeedMemberInputsRow[]>(
      this.currentEntityManager(),
      `
        SELECT
          u.id::text AS user_id,
          u.age_group::text AS age_group,
          COALESCE(
            (
              SELECT array_agg(
                DISTINCT preference.category_code
                ORDER BY preference.category_code
              )
                FROM user_category_preferences preference
               WHERE preference.user_id = u.id
                 AND preference.weight > 0
            ),
            ARRAY[]::text[]
          ) AS selected_category_codes,
          COALESCE(
            (
              SELECT array_agg(
                DISTINCT preference.entity_id::text
                ORDER BY preference.entity_id::text
              )
                FROM user_entity_preferences preference
               WHERE preference.user_id = u.id
                 AND preference.weight > 0
            ),
            ARRAY[]::text[]
          ) AS selected_entity_ids,
          COALESCE(
            (
              SELECT array_agg(
                DISTINCT preference.region_code
                ORDER BY preference.region_code
              )
                FROM user_region_preferences preference
               WHERE preference.user_id = u.id
                 AND preference.weight > 0
            ),
            ARRAY[]::text[]
          ) AS preferred_region_codes,
          COALESCE(
            (
              SELECT array_agg(
                DISTINCT issue.category_code
                ORDER BY issue.category_code
              )
                FROM user_interaction_events event
                JOIN issues issue ON issue.id = event.issue_id
               WHERE event.user_id = u.id
            ),
            ARRAY[]::text[]
          ) AS acted_category_codes
        FROM users u
        WHERE u.id = $1::uuid
      `,
      [userId],
    );
    const row = rows[0];
    const persistedUserId = nullableString(row?.user_id ?? row?.userId);
    if (persistedUserId === null) {
      return { context: null, actedCategoryCodes: [] };
    }

    return {
      context: {
        userId: persistedUserId,
        selectedCategoryCodes: sortedStringArray(
          row?.selected_category_codes ?? row?.selectedCategoryCodes,
        ),
        selectedEntityIds: sortedStringArray(row?.selected_entity_ids ?? row?.selectedEntityIds),
        preferredRegionCodes: sortedStringArray(
          row?.preferred_region_codes ?? row?.preferredRegionCodes,
        ),
        ageGroup: ageGroupValue(row?.age_group ?? row?.ageGroup),
      },
      actedCategoryCodes: sortedStringArray(row?.acted_category_codes ?? row?.actedCategoryCodes),
    };
  }

  async findActedCategoryCodes(userId: string): Promise<string[]> {
    const manager = this.currentSqlEntityManager();
    const interactionIssueIds = manager
      .createQueryBuilder(IssueQueryInteractionEntity, 'event')
      .select('event.issueId')
      .where({ userId });
    const rows = await manager.find(
      IssueQueryIssueEntity,
      {
        id: { $in: interactionIssueIds },
      },
      {
        fields: ['id', 'categoryCode'],
      },
    );
    return uniqueStrings(rows.map((row) => row.categoryCode)).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  async findConnectedIssueIds(seedIssueIds: ReadonlySet<string>): Promise<string[]> {
    if (seedIssueIds.size === 0) return [];
    const manager = this.currentEntityManager();
    const relations = await manager.find(
      IssueQueryRelationEntity,
      {
        fromIssueId: { $in: [...seedIssueIds] },
        relationType: 'FOLLOW_UP',
      },
      {
        fields: ['fromIssueId', 'toIssueId', 'relationType', 'verifiedAt'],
      },
    );
    if (relations.length === 0) return [];
    const issueIds = new Set(
      relations.flatMap((relation) => [relation.fromIssueId, relation.toIssueId]),
    );
    const issues = await manager.find(
      IssueQueryIssueEntity,
      { id: { $in: [...issueIds] } },
      { fields: ['id', 'eventAt'] },
    );
    const eventAtById = new Map(
      issues.map((issue) => [issue.id, nullableDate(issue.eventAt)?.getTime() ?? null]),
    );
    return uniqueStrings(
      relations
        .filter(
          (relation) =>
            relation.verifiedAt !== null &&
            relation.verifiedAt !== undefined &&
            (eventAtById.get(relation.fromIssueId) ?? null) !== null &&
            (eventAtById.get(relation.toIssueId) ?? null) !== null &&
            (eventAtById.get(relation.toIssueId) as number) >
              (eventAtById.get(relation.fromIssueId) as number),
        )
        .map((relation) => relation.toIssueId),
    );
  }

  async findIssue(id: string): Promise<IssueRecord | null> {
    const issues = await this.loadIssueRecords(new Set([id]), 'detail');
    return issues[0] ?? null;
  }

  async findIssuesByIds(ids: ReadonlySet<string>): Promise<IssueRecord[]> {
    if (ids.size === 0) return [];
    return this.loadIssueRecords(ids, 'feed');
  }

  async findUserContext(userId: string): Promise<UserRecommendationContext | null> {
    const manager = this.currentEntityManager();
    const user = await manager.findOne(UserSchema, { id: userId }, { fields: ['id', 'ageGroup'] });
    if (user === null) return null;
    const [categoryPreferences, entityPreferences, regionPreferences] = await Promise.all([
      manager.find(
        UserCategoryPreferenceSchema,
        { userId, weight: { $gt: 0 } },
        {
          fields: ['userCategoryPreferencesId', 'userId', 'categoryCode', 'weight'],
          orderBy: { categoryCode: 'ASC' },
        },
      ),
      manager.find(
        UserEntityPreferenceSchema,
        { userId, weight: { $gt: 0 } },
        {
          fields: ['userEntityPreferenceId', 'userId', 'entityId', 'weight'],
          orderBy: { entityId: 'ASC' },
        },
      ),
      manager.find(
        UserRegionPreferenceSchema,
        { userId, weight: { $gt: 0 } },
        { fields: ['id', 'userId', 'regionCode', 'weight'], orderBy: { regionCode: 'ASC' } },
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
    const rows = await this.currentSqlEntityManager()
      .createQueryBuilder(IssueQueryInteractionEntity, 'event')
      .select([
        'event.id',
        'event.userId',
        'event.issueId',
        'event.eventType',
        'event.acceptedOrder',
        'event.createdAt',
      ])
      .where({ userId })
      .distinctOn('event.issueId')
      .orderBy({ issueId: QueryOrder.ASC, acceptedOrder: QueryOrder.DESC, id: QueryOrder.DESC })
      .getResultList();
    return rows.map((row) => ({
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

  private async findCandidateIssueIds(
    manager: PostgreSqlEntityManager,
    excludedIssueIds: ReadonlySet<string>,
    limit: number | undefined,
    scope: IssueCandidateScope | undefined,
  ): Promise<CandidateIssueSelection> {
    const candidateLimit = limit === undefined ? undefined : normalizeLimit(limit);
    if (candidateLimit === 0) return emptyCandidateIssueSelection();

    const publicIssueIds = publicIssueDetailIds(manager);
    const baseWhere = candidateWhere(publicIssueIds, excludedIssueIds);
    if (scope === undefined || candidateLimit === undefined) {
      return toCandidateIssueSelection(
        await this.findCandidateIds(manager, baseWhere, candidateLimit, scope?.memberUserId),
      );
    }

    const issueIds: string[] = [];
    const connectedIssueIds = new Set<string>();
    const seenIds = new Set(excludedIssueIds);
    let remainingRows = candidateLimit;
    const memberUserId = scope?.memberUserId;
    for (const slice of buildCandidateSlices(manager, scope)) {
      if (remainingRows === 0) break;
      const sliceLimit = Math.min(
        remainingRows,
        Math.max(1, Math.floor(candidateLimit * slice.weight)),
      );
      const rows = await this.findCandidateIds(
        manager,
        combineIssueFilters(candidateWhere(publicIssueIds, seenIds), slice.where),
        sliceLimit,
        memberUserId,
        slice.connectedUserId,
      );
      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        issueIds.push(row.id);
        if (row.connected) connectedIssueIds.add(row.id);
        remainingRows -= 1;
        if (remainingRows === 0) break;
      }
    }
    if (remainingRows > 0) {
      const rows = await this.findCandidateIds(
        manager,
        candidateWhere(publicIssueIds, seenIds),
        remainingRows,
        memberUserId,
      );
      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        issueIds.push(row.id);
        if (row.connected) connectedIssueIds.add(row.id);
        remainingRows -= 1;
        if (remainingRows === 0) break;
      }
    }
    return { issueIds, connectedIssueIds };
  }

  private async findCandidateIds(
    manager: PostgreSqlEntityManager,
    where: IssueFilter,
    limit?: number,
    memberUserId?: string,
    connectedUserId?: string,
  ): Promise<CandidateIssueIdRow[]> {
    const query = manager.createQueryBuilder(IssueQueryIssueEntity, 'issue');
    const connectedProjection =
      connectedUserId !== undefined
        ? raw('true').as('connected')
        : memberUserId === undefined
          ? undefined
          : raw(`case when ${connectedCandidatePredicate('issue')} then true else false end`, [
              memberUserId,
            ]).as('connected');
    if (connectedProjection === undefined) {
      query.select('issue.id');
    } else {
      query.select(['issue.id', connectedProjection] as never);
    }
    query.where(where as unknown as QBFilterQuery<IssueQueryIssuePersistenceEntity, 'issue'>);
    if (memberUserId !== undefined) {
      query.andWhere(
        raw(
          `not exists (
             select 1
               from user_interaction_events interaction
              where interaction.user_id = ?::uuid
                and interaction.issue_id = issue.id
           )`,
          [memberUserId],
        ),
      );
    }
    if (connectedUserId !== undefined) {
      query.andWhere(raw((alias) => connectedCandidatePredicate(alias), [connectedUserId]));
    }
    query.orderBy(ISSUE_ORDER_BY);
    const maybeLimit = (query as unknown as { limit?: unknown }).limit;
    const hasConnection =
      typeof (manager as PostgreSqlEntityManager & { getConnection?: unknown }).getConnection ===
      'function';
    if (limit !== undefined && typeof maybeLimit === 'function') {
      (maybeLimit as (value: number) => unknown).call(query, limit);
    }
    const maybeExecute = (query as unknown as { execute?: unknown }).execute;
    if (
      process.env.NODE_ENV === 'test' &&
      !hasConnection &&
      memberUserId === undefined &&
      connectedUserId === undefined &&
      (typeof maybeExecute !== 'function' || typeof maybeLimit !== 'function')
    ) {
      // Lightweight repository doubles do not expose a SQL connection. Their
      // ORM find path is an explicit test-only compatibility boundary.
      const rows = await manager.find(IssueQueryIssueEntity, where, {
        orderBy: ISSUE_ORDER_BY,
        ...(limit === undefined ? {} : { limit }),
      });
      return rows.map((row) => ({ id: row.id, connected: false }));
    }
    if (
      typeof maybeExecute !== 'function' ||
      (limit !== undefined && typeof maybeLimit !== 'function')
    ) {
      throw new Error('candidate id projection query builder is unavailable');
    }
    const rows = (await query.execute('all', false)) as Array<Record<string, unknown>>;
    return rows.map((row, index) => {
      if (!isRecord(row)) {
        throw new Error(`candidate id projection returned an invalid row at index ${index}`);
      }
      const id = row.id ?? row.issue_id ?? row['issue.id'];
      if (typeof id !== 'string') {
        throw new Error(`candidate id projection returned an invalid id at index ${index}`);
      }
      return {
        id,
        connected: booleanValue(row.connected),
      };
    });
  }

  private async loadFeedRecommendationIssues(
    issueIds: ReadonlySet<string>,
    orderedIssueIds: readonly string[],
    connectedIssueIds: ReadonlySet<string>,
  ): Promise<FeedRecommendationIssue[]> {
    if (issueIds.size === 0) return [];
    const manager = this.currentEntityManager();
    const [issueRows, impacts, entityLinks] = await Promise.all([
      manager.find(
        IssueQueryIssueEntity,
        { id: { $in: [...issueIds] } },
        {
          fields: [
            'id',
            'categoryCode',
            'mainTopic',
            'representativeEntityId',
            'eventAt',
            'publicationStatus',
            'freshnessScore',
            'importanceScore',
          ],
        },
      ),
      manager.find(
        IssueQueryImpactEntity,
        { issueId: { $in: [...issueIds] } },
        { fields: ['id', 'issueId', 'targetType', 'targetValue'] },
      ),
      manager.find(
        IssueQueryEntityLinkEntity,
        { issueId: { $in: [...issueIds] } },
        { fields: ['issueEntitiesId', 'issueId', 'entityId'] },
      ),
    ]);
    const impactsByIssue = groupBy(impacts, (row) => row.issueId);
    const entityIdsByIssue = groupBy(entityLinks, (row) => row.issueId);
    const issuesById = new Map(
      issueRows.map((row) => {
        const issueImpacts = impactsByIssue.get(row.id) ?? [];
        return [
          row.id,
          toFeedRecommendationIssue(
            row,
            issueImpacts,
            entityIdsByIssue.get(row.id) ?? [],
            connectedIssueIds.has(row.id),
          ),
        ];
      }),
    );
    return orderedIssueIds.flatMap((issueId) => {
      const issue = issuesById.get(issueId);
      return issue === undefined || !isUsableFeedRecommendationIssue(issue) ? [] : [issue];
    });
  }

  private async loadFeedCardProjections(
    issueIds: ReadonlySet<string>,
  ): Promise<FeedCardProjection[]> {
    if (issueIds.size === 0) return [];
    const manager = this.currentEntityManager();
    const issueRows = await manager.find(
      IssueQueryIssueEntity,
      { id: { $in: [...issueIds] } },
      {
        fields: [
          'id',
          'title',
          'categoryCode',
          'eventAt',
          'publishedAt',
          'publicationStatus',
          'freshnessScore',
          'importanceScore',
        ],
      },
    );
    if (issueRows.length === 0) return [];
    const selectedIssueIds = new Set(issueRows.map((row) => row.id));
    const categoryCodes = [...new Set(issueRows.map((row) => row.categoryCode))];
    const [categories, details, articleCounts] = await Promise.all([
      manager.find(
        IssueCategorySchema,
        { code: { $in: categoryCodes } },
        { fields: ['code', 'displayName'] },
      ),
      manager.find(
        IssueQueryDetailEntity,
        { issueId: { $in: [...selectedIssueIds] } },
        { fields: ['id', 'issueId', 'integratedSummary', 'summaryLines'] },
      ),
      this.loadAvailableArticleCounts(manager, selectedIssueIds),
    ]);
    const categoryByCode = new Map(
      categories.map((category) => [String(category.code), String(category.displayName)]),
    );
    const detailsByIssue = new Map(details.map((detail) => [detail.issueId, detail]));
    return issueRows.map((row) =>
      toFeedCardProjection(
        row,
        categoryByCode.get(row.categoryCode) ?? row.categoryCode,
        detailsByIssue.get(row.id),
        articleCounts.get(row.id) ?? 0,
      ),
    );
  }

  private async loadIssueRecords(
    issueIds: ReadonlySet<string> | undefined,
    mode: IssueRecordLoadMode,
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
      mode === 'detail'
        ? manager.find(IssueQueryArticleLinkEntity, { issueId: { $in: [...selectedIssueIds] } })
        : Promise.resolve([] as IssueQueryArticleLinkPersistenceEntity[]),
    ]);

    const availableArticleCounts =
      mode === 'feed'
        ? await this.loadAvailableArticleCounts(manager, selectedIssueIds)
        : new Map<string, number>();
    const articleIds = [...new Set(articleLinks.map((row) => row.articleId))];
    const articles =
      mode !== 'detail' || articleIds.length === 0
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
      mode !== 'detail' || publisherIds.length === 0
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
        mode === 'feed' ? (availableArticleCounts.get(row.id) ?? 0) : availableArticles.length,
      );
      if (mode === 'detail') {
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

  private async loadAvailableArticleCounts(
    manager: EntityManager,
    issueIds: ReadonlySet<string>,
  ): Promise<Map<string, number>> {
    if (issueIds.size === 0) return new Map();
    const maybeGetConnection = (manager as EntityManager & { getConnection?: unknown })
      .getConnection;
    if (typeof maybeGetConnection !== 'function') {
      // Lightweight repository doubles do not expose a SQL connection. Keep
      // their behavior deterministic without making the production feed path
      // hydrate article and publisher rows.
      const links = await manager.find(IssueQueryArticleLinkEntity, {
        issueId: { $in: [...issueIds] },
      });
      if (links.length === 0) return new Map();
      const articles = await manager.find(IssueQueryArticleEntity, {
        id: { $in: [...new Set(links.map((link) => link.articleId))] },
      });
      const availableIds = new Set(
        articles
          .filter((article) => article.sourceStatus === 'AVAILABLE')
          .map((article) => article.id),
      );
      const counts = new Map<string, number>();
      for (const link of links) {
        if (availableIds.has(link.articleId)) {
          counts.set(link.issueId, (counts.get(link.issueId) ?? 0) + 1);
        }
      }
      return counts;
    }
    const query = (manager as PostgreSqlEntityManager)
      .createQueryBuilder(IssueQueryArticleLinkEntity, 'link')
      .select([sql`link.issue_id`.as('issueId'), raw('count(*)').as('articleCount')])
      .join(sql.ref('articles'), 'article', {
        'link.article_id': sql.ref('article.id'),
      })
      .where({
        [raw('link.issue_id')]: { $in: [...issueIds] },
        [raw('article.source_status')]: 'AVAILABLE',
      } as never)
      .groupBy(sql`link.issue_id` as never);
    const rows = (await query.execute('all', false)) as Array<Record<string, unknown>>;
    return new Map(
      rows.map((row, index) => {
        if (!isRecord(row)) {
          throw new Error(`available article count returned an invalid row at index ${index}`);
        }
        const issueId = row.issueId ?? row.issue_id;
        const articleCount = row.articleCount ?? row.article_count;
        if (
          typeof issueId !== 'string' ||
          (typeof articleCount !== 'string' && typeof articleCount !== 'number')
        ) {
          throw new Error(
            `available article count returned an invalid projection at index ${index}`,
          );
        }
        return [issueId, normalizeArticleCount(articleCount)] as const;
      }),
    );
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

interface FeedMemberInputsRow {
  user_id?: unknown;
  userId?: unknown;
  age_group?: unknown;
  ageGroup?: unknown;
  selected_category_codes?: unknown;
  selectedCategoryCodes?: unknown;
  selected_entity_ids?: unknown;
  selectedEntityIds?: unknown;
  preferred_region_codes?: unknown;
  preferredRegionCodes?: unknown;
  acted_category_codes?: unknown;
  actedCategoryCodes?: unknown;
}

type IssueRecordLoadMode = 'feed' | 'detail';
type IssueFilter = FilterQuery<IssueQueryIssuePersistenceEntity>;

interface CandidateIssueIdRow {
  id: string;
  connected: boolean;
}

interface CandidateIssueSelection {
  issueIds: string[];
  connectedIssueIds: Set<string>;
}

interface CandidateSlice {
  where: IssueFilter;
  weight: number;
  connectedUserId?: string;
}

const ISSUE_ORDER_BY = {
  importanceScore: 'DESC',
  freshnessScore: 'DESC',
  eventAt: 'DESC',
  id: 'ASC',
} as const;

function emptyCandidateIssueSelection(): CandidateIssueSelection {
  return { issueIds: [], connectedIssueIds: new Set() };
}

function toCandidateIssueSelection(rows: readonly CandidateIssueIdRow[]): CandidateIssueSelection {
  return {
    issueIds: rows.map((row) => row.id),
    connectedIssueIds: new Set(rows.filter((row) => row.connected).map((row) => row.id)),
  };
}

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
  if (scope.memberUserId !== undefined) {
    slices.push({ where: {}, weight: 0.15, connectedUserId: scope.memberUserId });
  } else if (connectedIds.length > 0) {
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

/**
 * Matches an issue that is the target of a verified, later FOLLOW_UP relation
 * from an issue whose latest interaction for the member is LIKE.
 *
 * The latest interaction set is derived before joining relations so PostgreSQL
 * can follow the existing from_issue_id-leading relation access path. The
 * outer IN keeps this predicate independent from a candidate-target probe,
 * while DISTINCT prevents multiple source relations from duplicating a target.
 */
function connectedCandidatePredicate(alias: string): string {
  return `${alias}.id in (
    select distinct relation.to_issue_id
      from (
        select distinct on (interaction.issue_id)
               interaction.issue_id,
               interaction.event_type
          from user_interaction_events interaction
         where interaction.user_id = ?::uuid
         order by interaction.issue_id, interaction.accepted_order desc, interaction.id desc
      ) latest_interaction
      join issue_relations relation
        on relation.from_issue_id = latest_interaction.issue_id
      join issues source_issue
        on source_issue.id = relation.from_issue_id
      join issues target_issue
        on target_issue.id = relation.to_issue_id
     where latest_interaction.event_type = 'LIKE'
       and relation.relation_type = 'FOLLOW_UP'
       and relation.verified_at is not null
       and source_issue.event_at is not null
       and target_issue.event_at is not null
       and target_issue.event_at > source_issue.event_at
  )`;
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
    [raw((alias) => `issue_card_summary_lines_valid(${alias}.summary_lines)`)]: [],
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

type FeedRecommendationIssueRow = Pick<
  IssueQueryIssuePersistenceEntity,
  | 'id'
  | 'categoryCode'
  | 'mainTopic'
  | 'representativeEntityId'
  | 'eventAt'
  | 'publicationStatus'
  | 'freshnessScore'
  | 'importanceScore'
>;

type FeedRecommendationImpactRow = Pick<
  IssueQueryImpactPersistenceEntity,
  'id' | 'issueId' | 'targetType' | 'targetValue'
>;

type FeedRecommendationEntityLinkRow = Pick<
  IssueQueryEntityLinkPersistenceEntity,
  'issueEntitiesId' | 'issueId' | 'entityId'
>;

type FeedCardIssueRow = Pick<
  IssueQueryIssuePersistenceEntity,
  | 'id'
  | 'title'
  | 'categoryCode'
  | 'eventAt'
  | 'publishedAt'
  | 'publicationStatus'
  | 'freshnessScore'
  | 'importanceScore'
>;

type FeedCardDetailRow = Pick<
  IssueQueryDetailPersistenceEntity,
  'id' | 'issueId' | 'integratedSummary' | 'summaryLines'
>;

function toFeedRecommendationIssue(
  row: FeedRecommendationIssueRow,
  impacts: FeedRecommendationImpactRow[],
  entityLinks: FeedRecommendationEntityLinkRow[],
  connected: boolean,
): FeedRecommendationIssue {
  return {
    id: row.id,
    categoryCode: row.categoryCode,
    mainTopic: nullableString(row.mainTopic),
    representativeEntityId: nullableString(row.representativeEntityId),
    entityIds: uniqueStrings(entityLinks.map((link) => link.entityId)),
    regionCodes: uniqueStrings(
      impacts
        .filter((impact) => impact.targetType === 'REGION')
        .map((impact) => impact.targetValue),
    ),
    ageGroups: impacts
      .filter((impact) => impact.targetType === 'AGE_GROUP')
      .map((impact) => impact.targetValue)
      .filter(isAgeGroup),
    eventAt: nullableDate(row.eventAt),
    publicationStatus: publicationStatusValue(row.publicationStatus),
    freshnessScore: numberValue(row.freshnessScore),
    importanceScore: numberValue(row.importanceScore),
    connected,
  };
}

function toFeedCardProjection(
  row: FeedCardIssueRow,
  categoryName: string,
  detail: FeedCardDetailRow | undefined,
  articleCount: number,
): FeedCardProjection {
  return {
    id: row.id,
    title: row.title,
    categoryCode: row.categoryCode,
    categoryName,
    eventAt: nullableDate(row.eventAt),
    publishedAt: nullableDate(row.publishedAt),
    integratedSummary: detail?.integratedSummary ?? null,
    summaryLines: stringArray(detail?.summaryLines),
    publicationStatus: publicationStatusValue(row.publicationStatus),
    freshnessScore: numberValue(row.freshnessScore),
    importanceScore: numberValue(row.importanceScore),
    articleCount,
  };
}

function toSession(row: FeedSessionPersistenceEntity, owner: FeedOwner): FeedSessionRecord {
  return {
    id: row.id,
    owner: { ...owner },
    algorithmVersion: row.algorithmVersion,
    candidateBudget: numberValue(row.candidateBudget),
    highScoreThreshold: numberValue(row.highScoreThreshold),
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

function feedOwnerWhere(
  owner: FeedOwner,
): Pick<FeedSessionPersistenceEntity, 'userId' | 'guestTokenHash'> {
  return owner.kind === 'MEMBER'
    ? { userId: owner.userId, guestTokenHash: null }
    : { userId: null, guestTokenHash: owner.guestTokenHash };
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
    issue.summaryLines.length === 3 &&
    issue.summaryLines.every((line) => typeof line === 'string' && line.trim().length > 0) &&
    Number.isFinite(issue.freshnessScore) &&
    issue.freshnessScore >= 0 &&
    issue.freshnessScore <= 1 &&
    Number.isFinite(issue.importanceScore) &&
    issue.importanceScore >= 0 &&
    issue.importanceScore <= 1
  );
}

function isUsableFeedRecommendationIssue(issue: FeedRecommendationIssue): boolean {
  return (
    issue.publicationStatus === 'PUBLISHED' &&
    Number.isFinite(issue.freshnessScore) &&
    issue.freshnessScore >= 0 &&
    issue.freshnessScore <= 1 &&
    Number.isFinite(issue.importanceScore) &&
    issue.importanceScore >= 0 &&
    issue.importanceScore <= 1
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

function sortedStringArray(value: unknown): string[] {
  return uniqueStrings(stringArray(value)).sort((left, right) => left.localeCompare(right));
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeArticleCount(value: string | number): number {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('available article count is outside the safe integer range');
  }
  return count;
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

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
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
