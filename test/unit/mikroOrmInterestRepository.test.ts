import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { generateUuidV7 } from '@newtine/core';
import { IssueSchema } from '@newtine/core/issue/persistence/issue.persistence.entity.js';
import { IssueCategorySchema } from '@newtine/core/onboarding/persistence/onboarding.persistence.entity.js';
import { MikroOrmInterestRepository } from '@newtine/core/interest/mikroOrmInterest.repository.js';

type TestEvent = {
  id: string;
  issueId: string;
  eventType: string;
  createdAt: Date;
};

type TestIssue = {
  id: string;
  categoryCode: string;
  title: string;
  publicationStatus: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type TestCategory = {
  code: string;
  displayName: string;
  displayOrder: number;
  createdAt: Date;
};

function createRepository(
  input: {
    events?: readonly TestEvent[];
    issues?: readonly TestIssue[];
    categories?: readonly TestCategory[];
  } = {},
) {
  const calls: {
    select?: readonly string[];
    where?: unknown;
    distinctOn?: string;
    orderBy?: unknown;
    finds: Array<{ entity: unknown; where: unknown }>;
  } = { finds: [] };
  const queryBuilder = {
    select(fields: readonly string[]) {
      calls.select = fields;
      return this;
    },
    where(where: unknown) {
      calls.where = where;
      return this;
    },
    distinctOn(fields: string) {
      calls.distinctOn = fields;
      return this;
    },
    orderBy(orderBy: unknown) {
      calls.orderBy = orderBy;
      return this;
    },
    async getResultList(): Promise<readonly TestEvent[]> {
      return input.events ?? [];
    },
  };
  const entityManager = {
    getContext: () => entityManager,
    createQueryBuilder: () => queryBuilder,
    find: async (
      entity: unknown,
      where: unknown,
    ): Promise<readonly (TestIssue | TestCategory)[]> => {
      calls.finds.push({ entity, where });
      if (entity === IssueSchema) {
        const issueWhere = where as {
          id?: { $in?: readonly string[] };
          publicationStatus?: string;
        };
        return (input.issues ?? []).filter(
          (candidate) =>
            (issueWhere.id?.$in === undefined || issueWhere.id.$in.includes(candidate.id)) &&
            (issueWhere.publicationStatus === undefined ||
              candidate.publicationStatus === issueWhere.publicationStatus),
        );
      }
      if (entity === IssueCategorySchema) {
        const categoryWhere = where as { code?: { $in?: readonly string[] } };
        return (input.categories ?? []).filter(
          (candidate) =>
            categoryWhere.code?.$in === undefined ||
            categoryWhere.code.$in.includes(candidate.code),
        );
      }
      return [];
    },
  };
  return {
    calls,
    repository: new MikroOrmInterestRepository(entityManager as never),
  };
}

function issue(id: string, categoryCode = 'housing', title = '이슈'): TestIssue {
  const now = new Date('2026-09-01T00:00:00.000Z');
  return {
    id,
    categoryCode,
    title,
    publicationStatus: 'PUBLISHED',
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function withdrawnIssue(id: string): TestIssue {
  return { ...issue(id), publicationStatus: 'WITHDRAWN' };
}

function category(code = 'housing', displayName = '주거', displayOrder = 1): TestCategory {
  return {
    code,
    displayName,
    displayOrder,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

test('interest analysis uses ORM query builder and derives period category counts', async () => {
  const firstIssueId = generateUuidV7();
  const secondIssueId = generateUuidV7();
  const userId = generateUuidV7();
  const startAt = new Date('2026-09-08T03:00:00.000Z');
  const endAt = new Date('2026-09-15T03:00:00.000Z');
  const { calls, repository } = createRepository({
    events: [
      {
        id: generateUuidV7(),
        issueId: firstIssueId,
        eventType: 'LIKE',
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      },
      {
        id: generateUuidV7(),
        issueId: secondIssueId,
        eventType: 'LIKE',
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    ],
    issues: [issue(firstIssueId), issue(secondIssueId)],
    categories: [category()],
  });

  const result = await repository.getInterestAnalysis(userId, { startAt, endAt });

  assert.deepEqual(result, {
    issueCount: 1,
    likedIssueCount: 2,
    categoryCounts: [{ categoryCode: 'housing', displayName: '주거', count: 1 }],
  });
  assert.deepEqual(calls.select, [
    'event.id',
    'event.issueId',
    'event.eventType',
    'event.createdAt',
  ]);
  assert.deepEqual(calls.where, { userId, createdAt: { $lt: endAt } });
  assert.equal(calls.distinctOn, 'event.issueId');
  assert.deepEqual(calls.orderBy, { issueId: 'ASC', createdAt: 'DESC', id: 'DESC' });
  assert.equal(calls.finds[0]?.entity, IssueSchema);
  assert.equal(calls.finds[1]?.entity, IssueCategorySchema);
});

test('liked issue query preserves an empty page and uses ORM filters', async () => {
  const userId = generateUuidV7();
  const asOf = new Date('2026-09-15T03:00:00.000Z');
  const { calls, repository } = createRepository();

  const result = await repository.getLikedIssues(userId, {
    asOf,
    categoryCode: 'housing',
    limit: 20,
  });

  assert.deepEqual(result, { items: [], totalCount: 0, nextCursor: null });
  assert.deepEqual(calls.where, { userId, createdAt: { $lt: asOf } });
  assert.equal(calls.finds.length, 0);
});

test('liked issue query creates an opaque keyset cursor from the last ORM row', async () => {
  const firstIssueId = generateUuidV7();
  const secondIssueId = generateUuidV7();
  const likedAt = new Date('2026-09-14T12:00:00.000Z');
  const { repository } = createRepository({
    events: [
      { id: generateUuidV7(), issueId: firstIssueId, eventType: 'LIKE', createdAt: likedAt },
      {
        id: generateUuidV7(),
        issueId: secondIssueId,
        eventType: 'LIKE',
        createdAt: new Date('2026-09-14T11:00:00.000Z'),
      },
    ],
    issues: [issue(firstIssueId, 'housing', '청년 주거 지원 정책 개편'), issue(secondIssueId)],
    categories: [category()],
  });

  const result = await repository.getLikedIssues(generateUuidV7(), {
    asOf: new Date('2026-09-15T03:00:00.000Z'),
    limit: 1,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.issueId, firstIssueId);
  assert.deepEqual(result.nextCursor, { likedAt, issueId: firstIssueId });
});

test('current likes exclude non-LIKE actions and non-published issues', async () => {
  const skippedIssueId = generateUuidV7();
  const withdrawnIssueId = generateUuidV7();
  const publishedIssueId = generateUuidV7();
  const { repository } = createRepository({
    events: [
      {
        id: generateUuidV7(),
        issueId: skippedIssueId,
        eventType: 'SKIP',
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      },
      {
        id: generateUuidV7(),
        issueId: withdrawnIssueId,
        eventType: 'LIKE',
        createdAt: new Date('2026-09-14T11:00:00.000Z'),
      },
      {
        id: generateUuidV7(),
        issueId: publishedIssueId,
        eventType: 'LIKE',
        createdAt: new Date('2026-09-14T10:00:00.000Z'),
      },
    ],
    issues: [issue(skippedIssueId), withdrawnIssue(withdrawnIssueId), issue(publishedIssueId)],
    categories: [category()],
  });

  const result = await repository.getInterestAnalysis(generateUuidV7(), {
    startAt: new Date('2026-09-08T03:00:00.000Z'),
    endAt: new Date('2026-09-15T03:00:00.000Z'),
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.likedIssueCount, 1);
  assert.equal(result.categoryCounts[0]?.count, 1);
});
