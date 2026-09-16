import { EntityManager, QueryOrder } from '@mikro-orm/core';
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { IssueException, IssueExceptionCode } from '../issue/domain/issue.exception.js';
import { generateUuidV7 } from '../common/id/uuidV7.generator.js';

import type { CategoryCode } from '../common/category/category.catalog.js';
import type { UuidV7 } from '../common/id/uuidV7.generator.js';
import {
  IssueSchema,
  type Issue,
} from '@newtine/core/issue/persistence/issue.persistence.entity.js';
import { IssueCategorySchema } from '@newtine/core/onboarding/persistence/onboarding.persistence.entity.js';
import {
  UserInteractionEventSchema,
  type UserInteractionEventPersistenceEntity,
} from './persistence/interest.persistence.entity.js';
import type {
  InterestAnalysisPeriod,
  InterestAnalysisSnapshot,
  InterestCategoryCount,
  InterestRepository,
  InterestWriteRepository,
  InteractionAcceptance,
  RecordInteractionCommand,
  StartDetailViewCommand,
  DetailViewStarted,
  UpdateDetailViewCommand,
  DetailViewProgress,
  InterestEventType,
  LikedIssue,
  LikedIssuesQuery,
  LikedIssuesResult,
} from './interest.model.js';
import {
  detailDwellContribution,
  detailDwellScore,
  interactionActionDelta,
  interactionActionScore,
} from './interest.policy.js';

interface CurrentLikedIssue {
  readonly issue: Issue;
  readonly likedAt: Date;
  readonly categoryDisplayName: string;
  readonly categoryDisplayOrder: number;
}

type LatestInteractionEvent = Pick<
  UserInteractionEventPersistenceEntity,
  'id' | 'issueId' | 'eventType' | 'acceptedOrder' | 'createdAt'
>;

/**
 * MikroORM adapter for the immutable interaction-derived interest model.
 *
 * Read projections use MikroORM metadata and query APIs. Transactional action
 * writes use parameterized PostgreSQL statements through the ambient MikroORM
 * context so row locks and the event/contribution/preference commit share one
 * transaction.
 */
@Injectable()
export class MikroOrmInterestRepository implements InterestRepository, InterestWriteRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async getInterestAnalysis(
    userId: UuidV7,
    period: InterestAnalysisPeriod,
  ): Promise<InterestAnalysisSnapshot> {
    const currentLikes = await this.loadCurrentLikes(userId, period.endAt);
    const periodLikes = currentLikes.filter(({ likedAt }) => likedAt >= period.startAt);
    const categoryCounts = countCategories(periodLikes);

    return {
      issueCount: periodLikes.length,
      likedIssueCount: currentLikes.length,
      categoryCounts,
    };
  }

  async getLikedIssues(userId: UuidV7, query: LikedIssuesQuery): Promise<LikedIssuesResult> {
    const currentLikes = await this.loadCurrentLikes(userId);
    const eligible = currentLikes
      .filter(
        ({ issue }) =>
          query.categoryCode === undefined || issue.categoryCode === query.categoryCode,
      )
      .sort(compareLikedIssues);
    const totalCount = eligible.length;
    const cursor = query.cursor;
    const afterCursor =
      cursor === undefined ? eligible : eligible.filter((item) => isAfterCursor(item, cursor));
    // Fetch one sentinel row so a full page only emits a cursor when another
    // eligible row actually exists. This avoids an empty trailing request.
    const page = afterCursor.slice(0, query.limit + 1);
    const hasMore = page.length > query.limit;
    const pageItems = page.slice(0, query.limit).map(toLikedIssue);
    const last = pageItems.at(-1);

    return {
      items: pageItems,
      totalCount,
      nextCursor:
        !hasMore || last === undefined
          ? null
          : {
              likedAt: last.likedAt,
              issueId: last.issueId,
              ...(query.categoryCode === undefined ? {} : { categoryCode: query.categoryCode }),
            },
    };
  }

  async recordInteraction(command: RecordInteractionCommand): Promise<InteractionAcceptance> {
    this.requireTransaction();
    await this.requireUser(command.userId);

    const existing = await this.queryOne<InteractionRow>(
      `
        SELECT id::text AS id, user_id::text AS user_id, issue_id::text AS issue_id,
               session_id::text AS session_id, event_type, created_at
          FROM user_interaction_events
         WHERE id = ?::uuid
         FOR UPDATE
      `,
      [command.eventId],
    );
    if (existing !== undefined) {
      return this.resolveExistingInteraction(command, existing);
    }

    const issue = await this.queryOne<IssueCategoryRow>(
      `
        SELECT id::text AS id, category_code
          FROM issues
         WHERE id = ?::uuid
           AND publication_status = 'PUBLISHED'
         FOR UPDATE
      `,
      [command.issueId],
    );
    if (issue === undefined) {
      throw new IssueException(IssueExceptionCode.NotFound, '이슈를 찾을 수 없습니다.');
    }

    const latest = await this.queryOne<LatestActionRow>(
      `
        SELECT event_type
          FROM user_interaction_events
         WHERE user_id = ?::uuid AND issue_id = ?::uuid
         ORDER BY accepted_order DESC, id DESC
         LIMIT 1
         FOR UPDATE
      `,
      [command.userId, command.issueId],
    );
    const contribution = await this.queryOne<ContributionRow>(
      `
        SELECT category_code, action_score, credited_dwell_ms, dwell_score
          FROM user_issue_contributions
         WHERE user_id = ?::uuid AND issue_id = ?::uuid
         FOR UPDATE
      `,
      [command.userId, command.issueId],
    );
    const previousAction = latest === undefined ? null : normalizeEventType(latest.event_type);
    const nextScore = interactionActionScore(command.action);
    const categoryCode = contribution?.category_code ?? issue.category_code;
    const delta = interactionActionDelta(previousAction, command.action);
    const inserted = await this.queryOne<InsertedInteractionRow>(
      `
        INSERT INTO user_interaction_events
          (id, user_id, issue_id, session_id, event_type, dwell_time, previous_action, created_at)
        VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::text, NULL, ?::text, clock_timestamp())
        ON CONFLICT (id) DO NOTHING
        RETURNING id::text AS id, created_at
      `,
      [
        command.eventId,
        command.userId,
        command.issueId,
        command.sessionId,
        command.action,
        previousAction,
      ],
    );
    if (inserted === undefined) {
      const conflicting = await this.queryOne<InteractionRow>(
        `
          SELECT id::text AS id, user_id::text AS user_id, issue_id::text AS issue_id,
                 session_id::text AS session_id, event_type, created_at
            FROM user_interaction_events
           WHERE id = ?::uuid
           FOR UPDATE
        `,
        [command.eventId],
      );
      if (conflicting === undefined) {
        throw new Error('interaction insert conflict row is unavailable');
      }
      return this.resolveExistingInteraction(command, conflicting);
    }

    await this.upsertContribution({
      userId: command.userId,
      issueId: command.issueId,
      categoryCode,
      actionScore: nextScore,
      creditedDwellMilliseconds: numeric(contribution?.credited_dwell_ms),
      dwellScore: numeric(contribution?.dwell_score),
      lastActionEventId: command.eventId,
    });
    await this.applyCategoryDelta(command.userId, categoryCode, delta);

    return {
      eventId: command.eventId,
      issueId: command.issueId,
      acceptedAction: command.action,
      acceptedAt: toDate(inserted.created_at),
    };
  }

  async startDetailView(command: StartDetailViewCommand): Promise<DetailViewStarted> {
    this.requireTransaction();
    await this.requireUser(command.userId);
    const existing = await this.queryOne<DetailViewRow>(
      `
        SELECT view_id::text AS view_id, user_id::text AS user_id, issue_id::text AS issue_id,
               session_id::text AS session_id, started_at, expires_at
          FROM issue_detail_views
         WHERE view_id = ?::uuid
         FOR UPDATE
      `,
      [command.viewId],
    );
    if (existing !== undefined) {
      return this.resolveExistingDetailView(command, existing);
    }

    const issue = await this.queryOne<{ id: string }>(
      `
        SELECT id::text AS id
          FROM issues
         WHERE id = ?::uuid AND publication_status = 'PUBLISHED'
         FOR UPDATE
      `,
      [command.issueId],
    );
    if (issue === undefined) {
      throw new IssueException(IssueExceptionCode.NotFound, '이슈를 찾을 수 없습니다.');
    }

    const inserted = await this.queryOne<DetailViewRow>(
      `
        INSERT INTO issue_detail_views
          (view_id, user_id, issue_id, session_id, started_at, expires_at, active_ms)
        VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, clock_timestamp(),
                clock_timestamp() + interval '30 minutes', 0)
        ON CONFLICT (view_id) DO NOTHING
        RETURNING view_id::text AS view_id, user_id::text AS user_id,
                  issue_id::text AS issue_id, session_id::text AS session_id,
                  started_at, expires_at
      `,
      [command.viewId, command.userId, command.issueId, command.sessionId],
    );
    if (inserted === undefined) {
      const conflicting = await this.queryOne<DetailViewRow>(
        `
          SELECT view_id::text AS view_id, user_id::text AS user_id, issue_id::text AS issue_id,
                 session_id::text AS session_id, started_at, expires_at
            FROM issue_detail_views
           WHERE view_id = ?::uuid
           FOR UPDATE
        `,
        [command.viewId],
      );
      if (conflicting === undefined) {
        throw new Error('detail view insert conflict row is unavailable');
      }
      return this.resolveExistingDetailView(command, conflicting);
    }
    return {
      viewId: command.viewId,
      issueId: command.issueId,
      startedAt: toDate(inserted.started_at),
      expiresAt: toDate(inserted.expires_at),
      created: true,
    };
  }

  async updateDetailView(command: UpdateDetailViewCommand): Promise<DetailViewProgress> {
    this.requireTransaction();
    await this.requireUser(command.userId);
    const view = await this.queryOne<DetailViewProgressRow>(
      `
        SELECT view_id::text AS view_id, user_id::text AS user_id, issue_id::text AS issue_id,
               expires_at, active_ms,
               clock_timestamp() >= expires_at AS expired,
               GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - started_at)) * 1000)
                 AS server_elapsed_ms
          FROM issue_detail_views
         WHERE view_id = ?::uuid
         FOR UPDATE
      `,
      [command.viewId],
    );
    if (
      view === undefined ||
      view.user_id.toLowerCase() !== command.userId.toLowerCase() ||
      view.issue_id.toLowerCase() !== command.issueId.toLowerCase()
    ) {
      throw new IssueException(
        IssueExceptionCode.DetailViewNotFound,
        '상세 열람을 찾을 수 없습니다.',
      );
    }
    if (
      !Number.isSafeInteger(command.activeMilliseconds) ||
      command.activeMilliseconds < 0 ||
      command.activeMilliseconds > 1_800_000
    ) {
      throw new IssueException(
        IssueExceptionCode.DetailViewInvalid,
        '체류시간 값이 올바르지 않습니다.',
      );
    }

    const currentActiveMilliseconds = numeric(view.active_ms);
    const acceptedMilliseconds = Math.max(currentActiveMilliseconds, command.activeMilliseconds);
    const contribution = await this.queryOne<ContributionRow>(
      `
        SELECT category_code, action_score, credited_dwell_ms, dwell_score
          FROM user_issue_contributions
         WHERE user_id = ?::uuid AND issue_id = ?::uuid
         FOR UPDATE
      `,
      [command.userId, command.issueId],
    );
    const storedCreditedMilliseconds = numeric(contribution?.credited_dwell_ms);
    const dwellContribution = detailDwellContribution(
      storedCreditedMilliseconds,
      currentActiveMilliseconds,
      acceptedMilliseconds,
    );
    if (acceptedMilliseconds <= currentActiveMilliseconds) {
      return {
        viewId: command.viewId,
        issueId: command.issueId,
        acceptedActiveMilliseconds: acceptedMilliseconds,
        totalCreditedMilliseconds: storedCreditedMilliseconds,
        dwellScore: detailDwellScore(storedCreditedMilliseconds),
      };
    }
    if (view.expired) {
      throw new IssueException(IssueExceptionCode.DetailViewExpired, '상세 열람이 만료되었습니다.');
    }

    const issue = await this.queryOne<IssueCategoryRow>(
      `
        SELECT id::text AS id, category_code
          FROM issues
         WHERE id = ?::uuid AND publication_status = 'PUBLISHED'
         FOR UPDATE
      `,
      [command.issueId],
    );
    if (issue === undefined) {
      throw new IssueException(
        IssueExceptionCode.DetailViewNotFound,
        '상세 열람을 찾을 수 없습니다.',
      );
    }
    if (command.activeMilliseconds > numeric(view.server_elapsed_ms)) {
      throw new IssueException(
        IssueExceptionCode.DetailViewInvalid,
        '서버 경과시간보다 큰 체류시간은 반영할 수 없습니다.',
      );
    }
    const categoryCode = contribution?.category_code ?? issue.category_code;
    const previousDwellScore = detailDwellScore(storedCreditedMilliseconds);
    const delta = dwellContribution.dwellScore - previousDwellScore;
    const updated = await this.queryOne<{ view_id: string }>(
      `
        UPDATE issue_detail_views
           SET active_ms = ?, expires_at = expires_at
         WHERE view_id = ?::uuid
           AND clock_timestamp() < expires_at
        RETURNING view_id::text AS view_id
      `,
      [acceptedMilliseconds, command.viewId],
    );
    if (updated === undefined) {
      throw new IssueException(IssueExceptionCode.DetailViewExpired, '상세 열람이 만료되었습니다.');
    }
    await this.upsertContribution({
      userId: command.userId,
      issueId: command.issueId,
      categoryCode,
      actionScore: numeric(contribution?.action_score),
      creditedDwellMilliseconds: dwellContribution.creditedMilliseconds,
      dwellScore: dwellContribution.dwellScore,
      lastActionEventId: null,
    });
    await this.applyCategoryDelta(command.userId, categoryCode, delta);

    return {
      viewId: command.viewId,
      issueId: command.issueId,
      acceptedActiveMilliseconds: acceptedMilliseconds,
      totalCreditedMilliseconds: dwellContribution.creditedMilliseconds,
      dwellScore: dwellContribution.dwellScore,
    };
  }

  async findCurrentInteraction(userId: UuidV7, issueId: UuidV7): Promise<InterestEventType | null> {
    const row = await this.queryOne<LatestActionRow>(
      `
        SELECT event_type
          FROM user_interaction_events
         WHERE user_id = ?::uuid AND issue_id = ?::uuid
         ORDER BY accepted_order DESC, id DESC
         LIMIT 1
      `,
      [userId, issueId],
    );
    return row === undefined ? null : normalizeEventType(row.event_type);
  }

  private resolveExistingInteraction(
    command: RecordInteractionCommand,
    existing: InteractionRow,
  ): InteractionAcceptance {
    if (
      existing.user_id.toLowerCase() !== command.userId.toLowerCase() ||
      existing.issue_id.toLowerCase() !== command.issueId.toLowerCase() ||
      existing.session_id.toLowerCase() !== command.sessionId.toLowerCase() ||
      normalizeEventType(existing.event_type) !== command.action
    ) {
      throw new IssueException(
        IssueExceptionCode.InteractionConflict,
        '이미 다른 행동으로 사용된 이벤트입니다.',
      );
    }
    return {
      eventId: command.eventId,
      issueId: command.issueId,
      acceptedAction: normalizeEventType(existing.event_type),
      acceptedAt: toDate(existing.created_at),
    };
  }

  private resolveExistingDetailView(
    command: StartDetailViewCommand,
    existing: DetailViewRow,
  ): DetailViewStarted {
    if (
      existing.user_id.toLowerCase() !== command.userId.toLowerCase() ||
      existing.issue_id.toLowerCase() !== command.issueId.toLowerCase() ||
      existing.session_id.toLowerCase() !== command.sessionId.toLowerCase()
    ) {
      throw new IssueException(
        IssueExceptionCode.DetailViewConflict,
        '이미 다른 상세 열람으로 사용된 ID입니다.',
      );
    }
    return {
      viewId: command.viewId,
      issueId: command.issueId,
      startedAt: toDate(existing.started_at),
      expiresAt: toDate(existing.expires_at),
      created: false,
    };
  }

  private async requireUser(userId: UuidV7): Promise<void> {
    const user = await this.queryOne<{ id: string }>(
      'SELECT id::text AS id FROM users WHERE id = ?::uuid FOR UPDATE',
      [userId],
    );
    if (user === undefined) {
      throw new IssueException(IssueExceptionCode.NotFound, '사용자를 찾을 수 없습니다.');
    }
  }

  private async upsertContribution(input: {
    userId: UuidV7;
    issueId: UuidV7;
    categoryCode: string;
    actionScore: number;
    creditedDwellMilliseconds: number;
    dwellScore: number;
    lastActionEventId: UuidV7 | null;
  }): Promise<void> {
    await this.execute(
      `
        INSERT INTO user_issue_contributions
          (user_id, issue_id, category_code, action_score, credited_dwell_ms,
           dwell_score, last_action_event_id, updated_at)
        VALUES (?::uuid, ?::uuid, ?::text, ?::numeric, ?::int,
                ?::numeric, ?::uuid, clock_timestamp())
        ON CONFLICT (user_id, issue_id)
        DO UPDATE SET
          action_score = EXCLUDED.action_score,
          credited_dwell_ms = EXCLUDED.credited_dwell_ms,
          dwell_score = EXCLUDED.dwell_score,
          last_action_event_id = COALESCE(EXCLUDED.last_action_event_id,
                                          user_issue_contributions.last_action_event_id),
          updated_at = clock_timestamp()
      `,
      [
        input.userId,
        input.issueId,
        input.categoryCode,
        input.actionScore,
        input.creditedDwellMilliseconds,
        input.dwellScore,
        input.lastActionEventId,
      ],
    );
  }

  private async applyCategoryDelta(
    userId: UuidV7,
    categoryCode: string,
    delta: number,
  ): Promise<void> {
    if (delta === 0) return;
    await this.execute(
      `
        INSERT INTO user_category_preferences
          (user_category_preferences_id, user_id, category_code, weight)
        VALUES (?::uuid, ?::uuid, ?::text, ?::numeric)
        ON CONFLICT (user_id, category_code)
        DO UPDATE SET weight = user_category_preferences.weight + EXCLUDED.weight
      `,
      [generateUuidV7(), userId, categoryCode, delta],
    );
  }

  private async loadCurrentLikes(
    userId: UuidV7,
    asOf?: Date,
  ): Promise<readonly CurrentLikedIssue[]> {
    const latestEvents = await this.loadLatestEvents(userId, asOf);
    const likedEvents = latestEvents.filter((event) => event.eventType === 'LIKE');
    if (likedEvents.length === 0) return [];

    const issueIds = likedEvents.map((event) => event.issueId);
    const issues = await this.currentEntityManager().find(IssueSchema, {
      id: { $in: issueIds },
      publicationStatus: 'PUBLISHED',
    });
    if (issues.length === 0) return [];

    const issueById = new Map(issues.map((issue) => [issue.id, issue]));
    const categoryCodes = [...new Set(issues.map((issue) => issue.categoryCode))];
    const categories = await this.currentEntityManager().find(IssueCategorySchema, {
      code: { $in: categoryCodes },
    });
    const categoryByCode = new Map(categories.map((category) => [category.code, category]));

    return likedEvents.flatMap((event) => {
      const issue = issueById.get(event.issueId);
      const category = issue === undefined ? undefined : categoryByCode.get(issue.categoryCode);
      if (issue === undefined || category === undefined) return [];
      return [
        {
          issue,
          likedAt: toDate(event.createdAt),
          categoryDisplayName: category.displayName,
          categoryDisplayOrder: category.displayOrder,
        },
      ];
    });
  }

  private async loadLatestEvents(
    userId: UuidV7,
    asOf?: Date,
  ): Promise<readonly LatestInteractionEvent[]> {
    const entityManager = this.currentEntityManager() as PostgreSqlEntityManager;
    const query = entityManager
      .createQueryBuilder(UserInteractionEventSchema, 'event')
      .select([
        'event.id',
        'event.issueId',
        'event.eventType',
        'event.acceptedOrder',
        'event.createdAt',
      ])
      .where({ userId });
    if (asOf !== undefined) query.andWhere({ createdAt: { $lt: asOf } });
    return query
      .distinctOn('event.issueId')
      .orderBy({ issueId: QueryOrder.ASC, acceptedOrder: QueryOrder.DESC, id: QueryOrder.DESC })
      .getResultList();
  }

  private currentEntityManager(): EntityManager {
    return this.entityManager.getContext(false);
  }

  private requireTransaction(): EntityManager {
    const manager = this.currentEntityManager();
    if (!manager.isInTransaction()) {
      throw new Error('interest write transaction context is unavailable');
    }
    return manager;
  }

  private async queryOne<T extends object>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    const manager = this.currentEntityManager();
    return (await manager
      .getConnection()
      .execute(sql, params, 'get', manager.getTransactionContext())) as T | undefined;
  }

  private async execute(sql: string, params: unknown[] = []): Promise<void> {
    const manager = this.currentEntityManager();
    await manager.getConnection().execute(sql, params, 'run', manager.getTransactionContext());
  }
}

interface InteractionRow {
  id: string;
  user_id: string;
  issue_id: string;
  session_id: string;
  event_type: string;
  created_at: Date | string;
}

interface LatestActionRow {
  event_type: string;
}

interface InsertedInteractionRow {
  id: string;
  created_at: Date | string;
}

interface IssueCategoryRow {
  id: string;
  category_code: string;
}

interface ContributionRow {
  category_code: string;
  action_score: number | string;
  credited_dwell_ms: number | string;
  dwell_score: number | string;
}

interface DetailViewRow {
  view_id: string;
  user_id: string;
  issue_id: string;
  session_id: string;
  started_at: Date | string;
  expires_at: Date | string;
}

interface DetailViewProgressRow {
  view_id: string;
  user_id: string;
  issue_id: string;
  expires_at: Date | string;
  active_ms: number | string;
  expired: boolean;
  server_elapsed_ms: number | string;
}

function countCategories(items: readonly CurrentLikedIssue[]): InterestCategoryCount[] {
  const counts = new Map<
    CategoryCode,
    { readonly displayName: string; readonly displayOrder: number; count: number }
  >();
  for (const item of items) {
    const categoryCode = item.issue.categoryCode as CategoryCode;
    const existing = counts.get(categoryCode);
    if (existing === undefined) {
      counts.set(categoryCode, {
        displayName: item.categoryDisplayName,
        displayOrder: item.categoryDisplayOrder,
        count: 1,
      });
    } else {
      existing.count += 1;
    }
  }

  return [...counts.entries()]
    .sort(([leftCode, left], [rightCode, right]) => {
      if (left.count !== right.count) return right.count - left.count;
      if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder;
      return compareLexical(leftCode, rightCode);
    })
    .map(([categoryCode, value]) => ({
      categoryCode,
      displayName: value.displayName,
      count: value.count,
    }));
}

function compareLikedIssues(left: CurrentLikedIssue, right: CurrentLikedIssue): number {
  const likedAtComparison = right.likedAt.getTime() - left.likedAt.getTime();
  if (likedAtComparison !== 0) return likedAtComparison;
  return compareLexical(right.issue.id, left.issue.id);
}

function isAfterCursor(
  item: CurrentLikedIssue,
  cursor: NonNullable<LikedIssuesQuery['cursor']>,
): boolean {
  const likedAtComparison = item.likedAt.getTime() - cursor.likedAt.getTime();
  if (likedAtComparison !== 0) return likedAtComparison < 0;
  return compareLexical(item.issue.id, cursor.issueId) < 0;
}

function compareLexical(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function toLikedIssue(item: CurrentLikedIssue): LikedIssue {
  return {
    issueId: item.issue.id as UuidV7,
    title: item.issue.title,
    categoryCode: item.issue.categoryCode as CategoryCode,
    categoryDisplayName: item.categoryDisplayName,
    likedAt: item.likedAt,
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeEventType(value: string): InterestEventType {
  return value === 'LIKE' || value === 'SKIP' || value === 'PASS' ? value : 'PASS';
}

function numeric(value: number | string | undefined, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}
