import { Inject, Injectable } from '@nestjs/common';

import {
  ISSUE_QUERY_REPOSITORY,
  IssueException,
  IssueExceptionCode,
  TRANSACTION_MANAGER,
  type FeedBatchRecord,
  type FeedOwner,
  type FeedSessionRecord,
  type IssueCandidateScope,
  type IssueRecord,
  type IssueQueryRepository,
  type TransactionManager,
  type UserRecommendationContext,
  type UserInteractionRecord,
} from '@newtine/core';

import {
  DEFAULT_CANDIDATE_BUDGET,
  DEFAULT_HIGH_SCORE_THRESHOLD,
  recommendFeed,
} from './recommendation/issueRecommendation.js';
import type { FeedBatchInput, FeedCursorPosition, FeedOwnerInput } from './type/feed.input.js';
import type {
  FeedBatchResult,
  FeedCardResult,
  FeedPageResult,
  FeedSessionResult,
} from './type/feed.output.js';

const DEFAULT_LIMIT = DEFAULT_CANDIDATE_BUDGET;

@Injectable()
export class IssueFeedService {
  private readonly candidateBudget = readBoundedInteger(
    process.env.RECOMMENDATION_CANDIDATE_BUDGET,
    DEFAULT_LIMIT,
    10,
    500,
  );
  private readonly highScoreThreshold = readBoundedNumber(
    process.env.RECOMMENDATION_HIGH_SCORE_THRESHOLD,
    DEFAULT_HIGH_SCORE_THRESHOLD,
    0,
    1,
  );

  constructor(
    @Inject(ISSUE_QUERY_REPOSITORY) private readonly repository: IssueQueryRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async createSession(ownerInput: FeedOwnerInput): Promise<FeedSessionResult> {
    const owner = normalizeOwner(ownerInput);
    const session = await this.createFeedSession(owner);
    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      nextBatchNo: session.nextBatchNo,
    };
  }

  async getBatch(input: FeedBatchInput): Promise<FeedBatchResult> {
    const page = await this.getBatchPage(input);
    return page.batch;
  }

  async getFeed(ownerInput: FeedOwnerInput, cursor?: FeedCursorPosition): Promise<FeedPageResult> {
    const owner = normalizeOwner(ownerInput);
    const position = cursor ?? (await this.createFeedSession(owner));
    const page = await this.getBatchPage({
      owner,
      sessionId: 'sessionId' in position ? position.sessionId : position.id,
      batchNo: 'sessionId' in position ? position.batchNo : 0,
    });
    return { ...page.batch, expiresAt: page.expiresAt };
  }

  private createFeedSession(owner: FeedOwner): Promise<FeedSessionRecord> {
    return this.transactionManager.execute(() =>
      this.repository.createFeedSession(owner, new Date(), {
        candidateBudget: this.candidateBudget,
        highScoreThreshold: this.highScoreThreshold,
      }),
    );
  }

  private async getBatchPage(
    input: FeedBatchInput,
  ): Promise<{ batch: FeedBatchResult; expiresAt: Date }> {
    return this.getBatchUnlocked(input);
  }

  private async getBatchUnlocked(
    input: FeedBatchInput,
  ): Promise<{ batch: FeedBatchResult; expiresAt: Date }> {
    const owner = normalizeOwner(input.owner);
    const now = new Date();
    const session = await this.repository.findFeedSession(input.sessionId, owner, now);
    if (session === null) {
      throw new IssueException(
        IssueExceptionCode.FeedSessionNotFound,
        '탐색 세션을 찾을 수 없습니다.',
      );
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      throw new IssueException(
        IssueExceptionCode.FeedSessionExpired,
        '탐색 세션이 만료되었습니다.',
      );
    }

    const storedBatch = await this.repository.findFeedBatch(session.id, input.batchNo);
    if (storedBatch !== null) {
      return { batch: await this.toBatchResult(storedBatch), expiresAt: session.expiresAt };
    }
    if (session.status === 'COMPLETED') {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '완료된 탐색 세션에는 새 묶음을 요청할 수 없습니다.',
      );
    }
    const previousBatches = await this.repository.findFeedBatches(session.id);
    const lastBatch = previousBatches[previousBatches.length - 1];
    if (lastBatch !== undefined && lastBatch.continuation !== 'CONTINUE') {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '제한 상태의 탐색 세션에는 새 묶음을 요청할 수 없습니다. 새 탐색을 시작하세요.',
      );
    }
    if (input.batchNo !== session.nextBatchNo) {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '요청한 묶음 번호가 현재 탐색 순서와 일치하지 않습니다.',
      );
    }

    const excludedIssueIds = new Set(
      previousBatches.flatMap((batch) => batch.items.map((item) => item.issueId)),
    );
    const latestInteractions =
      session.owner.kind === 'MEMBER'
        ? await this.repository.findLatestInteractions(session.owner.userId)
        : [];
    for (const interaction of latestInteractions) excludedIssueIds.add(interaction.issueId);

    const actedCategoryCodes = await this.findActedCategoryCodes(latestInteractions);
    const context =
      session.owner.kind === 'MEMBER'
        ? await this.repository.findUserContext(session.owner.userId)
        : null;
    const connectedIssueIds = await this.findConnectedIssueIds(latestInteractions);
    const issues = await this.repository.findCandidates(
      excludedIssueIds,
      session.candidateBudget + 1,
      toCandidateScope(context, actedCategoryCodes, connectedIssueIds, session.highScoreThreshold),
    );
    const recommendation = recommendFeed({
      issues,
      context,
      latestInteractions,
      actedCategoryCodes,
      connectedIssueIds,
      previousSession: session,
      highScoreThreshold: session.highScoreThreshold,
      candidateBudget: session.candidateBudget,
    });
    const batch: FeedBatchRecord = {
      sessionId: session.id,
      batchNo: input.batchNo,
      items: recommendation.items,
      continuation: recommendation.continuation,
      createdAt: now,
    };
    const nextSession: FeedSessionRecord = {
      ...session,
      nextBatchNo: input.batchNo + 1,
      status: recommendation.continuation === 'EXHAUSTED' ? 'COMPLETED' : 'ACTIVE',
      lastTopic: recommendation.lastTopic,
      lastRepresentativeEntityId: recommendation.lastRepresentativeEntityId,
      topicRun: recommendation.topicRun,
      entityRun: recommendation.entityRun,
    };
    const saveResult = await this.transactionManager.execute(() =>
      this.repository.saveFeedBatch(nextSession, batch),
    );
    const committedBatch = await this.repository.findFeedBatch(session.id, input.batchNo);
    if (committedBatch === null && saveResult === 'EXISTING') {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '저장된 탐색 묶음을 다시 읽을 수 없습니다.',
      );
    }
    return {
      batch: await this.toBatchResult(committedBatch ?? batch),
      expiresAt: session.expiresAt,
    };
  }

  private async findActedCategoryCodes(
    interactions: UserInteractionRecord[],
  ): Promise<Set<string>> {
    const categories = new Set<string>();
    const issues = await this.findIssuesByIds(new Set(interactions.map((item) => item.issueId)));
    for (const issue of issues) {
      categories.add(issue.categoryCode);
    }
    return categories;
  }

  private async findConnectedIssueIds(interactions: UserInteractionRecord[]): Promise<Set<string>> {
    const likeInteractions = interactions.filter((interaction) => interaction.eventType === 'LIKE');
    const seedIds = new Set(likeInteractions.map((interaction) => interaction.issueId));
    if (seedIds.size === 0) return new Set();
    const relations = await this.repository.findFollowUps(seedIds);
    const candidateIds = new Set<string>();
    const relationIssueIds = new Set(
      relations.flatMap((relation) => [relation.fromIssueId, relation.toIssueId]),
    );
    const issuesById = new Map(
      (await this.findIssuesByIds(relationIssueIds)).map((issue) => [issue.id, issue]),
    );
    for (const relation of relations) {
      const source = issuesById.get(relation.fromIssueId);
      const target = issuesById.get(relation.toIssueId);
      if (
        source?.eventAt !== null &&
        source?.eventAt !== undefined &&
        target?.eventAt !== null &&
        target?.eventAt !== undefined &&
        target.eventAt.getTime() > source.eventAt.getTime()
      ) {
        candidateIds.add(relation.toIssueId);
      }
    }
    return candidateIds;
  }

  private async toBatchResult(batch: FeedBatchRecord): Promise<FeedBatchResult> {
    const issuesById = new Map(
      (await this.findIssuesByIds(new Set(batch.items.map((item) => item.issueId)))).map(
        (issue) => [issue.id, issue],
      ),
    );
    const resolvedItems = batch.items.map((item) => {
      const issue = issuesById.get(item.issueId);
      return issue === undefined || !isUsableCard(issue)
        ? null
        : toCardResult(issue, item.selectionType, item.reasonCodes);
    });
    const items = resolvedItems.filter((item): item is FeedCardResult => item !== null);
    return {
      sessionId: batch.sessionId,
      batchNo: batch.batchNo,
      items,
      nextBatchNo: batch.continuation === 'CONTINUE' ? batch.batchNo + 1 : null,
      continuation: batch.continuation,
    };
  }

  private async findIssuesByIds(ids: ReadonlySet<string>): Promise<IssueRecord[]> {
    if (ids.size === 0) return [];
    if (this.repository.findIssuesByIds !== undefined) {
      return this.repository.findIssuesByIds(ids);
    }
    const issues = await Promise.all([...ids].map((id) => this.repository.findIssue(id)));
    return issues.filter((issue): issue is IssueRecord => issue !== null);
  }
}

export function normalizeOwner(owner: FeedOwnerInput): FeedOwner {
  return owner.kind === 'MEMBER'
    ? { kind: 'MEMBER', userId: owner.userId.toLowerCase() }
    : { kind: 'GUEST', guestTokenHash: owner.guestTokenHash.toLowerCase() };
}

function isUsableCard(issue: IssueRecord): boolean {
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

function toCardResult(
  issue: IssueRecord,
  selectionType: FeedCardResult['selectionType'],
  reasonCodes: string[],
): FeedCardResult {
  return {
    issueId: issue.id,
    title: issue.title,
    category: { code: issue.categoryCode, name: issue.categoryName },
    eventAt: issue.eventAt,
    publishedAt: issue.publishedAt,
    integratedSummary: issue.integratedSummary ?? '',
    summaryLines: [
      issue.summaryLines[0] ?? '',
      issue.summaryLines[1] ?? '',
      issue.summaryLines[2] ?? '',
    ],
    articleCount: normalizeCount(issue.articleCount),
    selectionType,
    reasonCodes: [...reasonCodes],
  };
}

function normalizeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function toCandidateScope(
  context: UserRecommendationContext | null,
  actedCategoryCodes: ReadonlySet<string>,
  connectedIssueIds: ReadonlySet<string>,
  highScoreThreshold: number,
): IssueCandidateScope {
  return {
    highScoreThreshold,
    selectedCategoryCodes: context?.selectedCategoryCodes ?? [],
    selectedEntityIds: context?.selectedEntityIds ?? [],
    preferredRegionCodes: context?.preferredRegionCodes ?? [],
    ageGroup: context?.ageGroup ?? null,
    actedCategoryCodes: [...actedCategoryCodes],
    connectedIssueIds: [...connectedIssueIds],
  };
}

function readBoundedNumber(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

function readBoundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
