import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ISSUE_QUERY_REPOSITORY,
  IssueException,
  IssueExceptionCode,
  TRANSACTION_MANAGER,
  type FeedCardProjection,
  type FeedBatchRecord,
  type FeedOwner,
  type FeedSessionRecord,
  type IssueCandidateScope,
  type IssueQueryRepository,
  type TransactionManager,
  type UserRecommendationContext,
} from '@newtine/core';

import {
  DEFAULT_CANDIDATE_BUDGET,
  DEFAULT_HIGH_SCORE_THRESHOLD,
  ISSUE_RECOMMENDATION_ALGORITHM_VERSION,
  isSupportedRecommendationAlgorithm,
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
  private readonly logger = new Logger(IssueFeedService.name);
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
  private readonly algorithmVersion = readAlgorithmVersion(
    process.env.RECOMMENDATION_ALGORITHM_VERSION,
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
    const owner = normalizeOwner(input.owner);
    const trace = new FeedStageTrace(this.logger, owner.kind, 'cursor');
    try {
      const page = await this.getBatchPage(input, undefined, trace);
      trace.finish({ outcome: 'success', itemCount: page.batch.items.length });
      return page.batch;
    } catch (error) {
      trace.finish({ outcome: 'error', itemCount: 0 });
      throw error;
    }
  }

  async getFeed(ownerInput: FeedOwnerInput, cursor?: FeedCursorPosition): Promise<FeedPageResult> {
    const owner = normalizeOwner(ownerInput);
    const trace = new FeedStageTrace(
      this.logger,
      owner.kind,
      cursor === undefined ? 'new' : 'cursor',
    );
    try {
      const createdSession =
        cursor === undefined
          ? await trace.stage('session.create', () => this.createFeedSession(owner))
          : undefined;
      const position = cursor ?? {
        sessionId: createdSession!.id,
        batchNo: 0,
      };
      const page = await this.getBatchPage(
        {
          owner,
          sessionId: position.sessionId,
          batchNo: position.batchNo,
        },
        createdSession,
        trace,
      );
      trace.finish({ outcome: 'success', itemCount: page.batch.items.length });
      return { ...page.batch, expiresAt: page.expiresAt };
    } catch (error) {
      trace.finish({ outcome: 'error', itemCount: 0 });
      throw error;
    }
  }

  private createFeedSession(owner: FeedOwner): Promise<FeedSessionRecord> {
    return this.transactionManager.execute(() =>
      this.repository.createFeedSession(owner, new Date(), {
        algorithmVersion: this.algorithmVersion,
        candidateBudget: this.candidateBudget,
        highScoreThreshold: this.highScoreThreshold,
      }),
    );
  }

  private async getBatchPage(
    input: FeedBatchInput,
    preloadedSession: FeedSessionRecord | undefined,
    trace: FeedStageTrace,
  ): Promise<{ batch: FeedBatchResult; expiresAt: Date }> {
    return this.getBatchUnlocked(input, preloadedSession, trace);
  }

  private async getBatchUnlocked(
    input: FeedBatchInput,
    preloadedSession: FeedSessionRecord | undefined,
    trace: FeedStageTrace,
  ): Promise<{ batch: FeedBatchResult; expiresAt: Date }> {
    const owner = normalizeOwner(input.owner);
    const now = new Date();
    const session =
      preloadedSession ??
      (await trace.stage('session.read', () =>
        this.repository.findFeedSession(input.sessionId, owner, now),
      ));
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

    const storedBatch =
      preloadedSession !== undefined && input.batchNo === 0
        ? null
        : await trace.stage('batch.read', () =>
            this.repository.findFeedBatch(session.id, input.batchNo),
          );
    if (storedBatch !== null) {
      return {
        batch: await trace.stage('cards.read', () => this.toBatchResult(storedBatch)),
        expiresAt: session.expiresAt,
      };
    }
    if (session.status === 'COMPLETED') {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '완료된 탐색 세션에는 새 묶음을 요청할 수 없습니다.',
      );
    }
    const previousBatches =
      preloadedSession !== undefined && input.batchNo === 0
        ? []
        : await trace.stage('batches.read', () => this.repository.findFeedBatches(session.id));
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
    if (!isSupportedRecommendationAlgorithm(session.algorithmVersion)) {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '지원하지 않는 탐색 알고리즘 버전입니다. 새 탐색을 시작하세요.',
      );
    }

    const excludedIssueIds = new Set(
      previousBatches.flatMap((batch) => batch.items.map((item) => item.issueId)),
    );
    const memberUserId = session.owner.kind === 'MEMBER' ? session.owner.userId : undefined;
    let actedCategoryCodes = new Set<string>();
    let context: UserRecommendationContext | null = null;
    if (memberUserId !== undefined) {
      const memberInputs = await trace.stage('member-inputs.read', () =>
        this.repository.findFeedMemberInputs(memberUserId),
      );
      actedCategoryCodes = new Set(memberInputs.actedCategoryCodes);
      context = memberInputs.context;
    }
    const scope = toCandidateScope(
      context,
      actedCategoryCodes,
      session.highScoreThreshold,
      memberUserId,
    );
    const issues = await trace.stage('candidates.read', () =>
      this.repository.findFeedCandidates(excludedIssueIds, session.candidateBudget + 1, scope),
    );
    const recommendation = await trace.stage('recommendation.compute', () =>
      Promise.resolve(
        recommendFeed(
          {
            issues,
            context,
            actedCategoryCodes,
            previousSession: session,
            highScoreThreshold: session.highScoreThreshold,
            candidateBudget: session.candidateBudget,
          },
          session.algorithmVersion,
        ),
      ),
    );
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
    const saveResult = await trace.stage('batch.save', () =>
      this.transactionManager.execute(() => this.repository.saveFeedBatch(nextSession, batch)),
    );
    return {
      batch: await trace.stage('cards.read', () => this.toBatchResult(saveResult.batch)),
      expiresAt: session.expiresAt,
    };
  }
  private async toBatchResult(batch: FeedBatchRecord): Promise<FeedBatchResult> {
    const issuesById = new Map(
      (await this.repository.findFeedCards(new Set(batch.items.map((item) => item.issueId)))).map(
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
}

export function normalizeOwner(owner: FeedOwnerInput): FeedOwner {
  return owner.kind === 'MEMBER'
    ? { kind: 'MEMBER', userId: owner.userId.toLowerCase() }
    : { kind: 'GUEST', guestTokenHash: owner.guestTokenHash.toLowerCase() };
}

function isUsableCard(issue: FeedCardProjection): boolean {
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
  issue: FeedCardProjection,
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
  highScoreThreshold: number,
  memberUserId?: string,
): IssueCandidateScope {
  return {
    memberUserId,
    highScoreThreshold,
    selectedCategoryCodes: context?.selectedCategoryCodes ?? [],
    selectedEntityIds: context?.selectedEntityIds ?? [],
    preferredRegionCodes: context?.preferredRegionCodes ?? [],
    ageGroup: context?.ageGroup ?? null,
    actedCategoryCodes: [...actedCategoryCodes],
    connectedIssueIds: [],
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

function readAlgorithmVersion(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return ISSUE_RECOMMENDATION_ALGORITHM_VERSION;
  const value = raw.trim();
  if (!isSupportedRecommendationAlgorithm(value)) {
    throw new Error(`unsupported recommendation algorithm version: ${value}`);
  }
  return value;
}

type FeedTraceOutcome = 'success' | 'error';
type FeedTracePageKind = 'new' | 'cursor';
type FeedTraceOwnerKind = 'MEMBER' | 'GUEST';

/**
 * Emits one low-cardinality record only for sampled or slow feed requests.
 * It deliberately contains stage names and bounded counts, never SQL,
 * session/user identifiers, tokens, or response content.
 */
class FeedStageTrace {
  private readonly startedAt = process.hrtime.bigint();
  private readonly stages = new Map<string, number>();
  private readonly slowThresholdMs = readPositiveIntegerEnv('FEED_STAGE_SLOW_THRESHOLD_MS', 500);
  private readonly sampleRate = readRateEnv('FEED_STAGE_SAMPLE_RATE', 0);

  constructor(
    private readonly logger: Logger,
    private readonly ownerKind: FeedTraceOwnerKind,
    private readonly pageKind: FeedTracePageKind,
  ) {}

  async stage<T>(name: string, work: () => Promise<T>): Promise<T> {
    const startedAt = process.hrtime.bigint();
    try {
      return await work();
    } finally {
      this.stages.set(name, elapsedMilliseconds(startedAt));
    }
  }

  finish(input: { outcome: FeedTraceOutcome; itemCount: number }): void {
    const totalMs = elapsedMilliseconds(this.startedAt);
    if (totalMs < this.slowThresholdMs && !shouldSample(this.sampleRate)) {
      return;
    }
    this.logger.log(
      JSON.stringify({
        event: 'feed.stage',
        ownerKind: this.ownerKind,
        pageKind: this.pageKind,
        outcome: input.outcome,
        totalMs,
        itemCount: Math.max(0, Math.min(10, input.itemCount)),
        stages: Object.fromEntries(this.stages),
      }),
      'FeedStageDiagnostics',
    );
  }
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function readRateEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function shouldSample(rate: number): boolean {
  return rate > 0 && Math.random() < rate;
}
