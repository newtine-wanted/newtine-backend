import { EntityManager, QueryOrder } from '@mikro-orm/core';
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type { CategoryCode } from '@newtine/core/common/category/category.catalog.js';
import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
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
  LikedIssue,
  LikedIssuesQuery,
  LikedIssuesResult,
} from './interest.model.js';

interface CurrentLikedIssue {
  readonly issue: Issue;
  readonly likedAt: Date;
  readonly categoryDisplayName: string;
  readonly categoryDisplayOrder: number;
}

type LatestInteractionEvent = Pick<
  UserInteractionEventPersistenceEntity,
  'id' | 'issueId' | 'eventType' | 'createdAt'
>;

/**
 * MikroORM adapter for the immutable interaction-derived interest model.
 *
 * All reads go through MikroORM metadata and query APIs. The one PostgreSQL
 * specific operation here is `distinctOn`, expressed through MikroORM's query
 * builder so the latest event per issue is selected in the database without
 * embedding SQL in the application adapter.
 */
@Injectable()
export class MikroOrmInterestRepository implements InterestRepository {
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
    const currentLikes = await this.loadCurrentLikes(userId, query.asOf);
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

  private async loadCurrentLikes(
    userId: UuidV7,
    asOf: Date,
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
    asOf: Date,
  ): Promise<readonly LatestInteractionEvent[]> {
    const entityManager = this.currentEntityManager() as PostgreSqlEntityManager;
    return entityManager
      .createQueryBuilder(UserInteractionEventSchema, 'event')
      .select(['event.id', 'event.issueId', 'event.eventType', 'event.createdAt'])
      .where({ userId, createdAt: { $lt: asOf } })
      .distinctOn('event.issueId')
      .orderBy({ issueId: QueryOrder.ASC, createdAt: QueryOrder.DESC, id: QueryOrder.DESC })
      .getResultList();
  }

  private currentEntityManager(): EntityManager {
    return this.entityManager.getContext(false);
  }
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
