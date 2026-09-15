import {
  generateUuidV7,
  IssueException,
  IssueExceptionCode,
  type FeedBatchRecord,
  type FeedOwner,
  type FeedSessionRecord,
  type IssueCandidateScope,
  type IssueQueryRepository,
  type IssueRecord,
  type IssueRelationRecord,
  type UserInteractionRecord,
  type UserRecommendationContext,
} from '@newtine/core';

export interface InMemoryIssueQuerySeed {
  issues?: readonly IssueRecord[];
  contexts?: readonly UserRecommendationContext[];
  interactions?: readonly UserInteractionRecord[];
  relations?: readonly IssueRelationRecord[];
}

/**
 * A deterministic test fixture for the repository port. It is intentionally kept
 * outside the application source tree so production wiring cannot select it.
 */
export class InMemoryIssueQueryRepository implements IssueQueryRepository {
  private readonly issues: IssueRecord[];
  private readonly contexts = new Map<string, UserRecommendationContext>();
  private readonly interactions: UserInteractionRecord[];
  private readonly relations: IssueRelationRecord[];
  private readonly sessions = new Map<string, FeedSessionRecord>();
  private readonly batches = new Map<string, FeedBatchRecord>();

  constructor(seed: InMemoryIssueQuerySeed = {}) {
    this.issues = (seed.issues ?? []).map(cloneIssue);
    for (const context of seed.contexts ?? []) {
      this.contexts.set(context.userId, cloneContext(context));
    }
    this.interactions = (seed.interactions ?? []).map(cloneInteraction);
    this.relations = (seed.relations ?? []).map(cloneRelation);
  }

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
    this.sessions.set(session.id, cloneSession(session));
    return cloneSession(session);
  }

  async findFeedSession(
    id: string,
    owner: FeedOwner,
    now: Date,
  ): Promise<FeedSessionRecord | null> {
    const session = this.sessions.get(id);
    if (session === undefined || !sameOwner(session.owner, owner)) return null;
    void now;
    return cloneSession(session);
  }

  async findFeedBatch(sessionId: string, batchNo: number): Promise<FeedBatchRecord | null> {
    const batch = this.batches.get(batchKey(sessionId, batchNo));
    return batch === undefined ? null : cloneBatch(batch);
  }

  async findFeedBatches(sessionId: string): Promise<FeedBatchRecord[]> {
    return [...this.batches.values()]
      .filter((batch) => batch.sessionId === sessionId)
      .sort((left, right) => left.batchNo - right.batchNo)
      .map(cloneBatch);
  }

  async saveFeedBatch(session: FeedSessionRecord, batch: FeedBatchRecord): Promise<void> {
    const key = batchKey(batch.sessionId, batch.batchNo);
    if (this.batches.has(key)) return;
    const currentSession = this.sessions.get(session.id);
    const previousBatches = [...this.batches.values()]
      .filter((storedBatch) => storedBatch.sessionId === session.id)
      .sort((left, right) => left.batchNo - right.batchNo);
    const lastBatch = previousBatches[previousBatches.length - 1];
    if (
      currentSession === undefined ||
      currentSession.status === 'COMPLETED' ||
      currentSession.nextBatchNo !== batch.batchNo ||
      (lastBatch !== undefined && lastBatch.continuation !== 'CONTINUE')
    ) {
      throw new IssueException(
        IssueExceptionCode.FeedBatchConflict,
        '현재 탐색 상태에서는 새 묶음을 저장할 수 없습니다.',
      );
    }
    this.batches.set(key, cloneBatch(batch));
    this.sessions.set(session.id, cloneSession(session));
  }

  async findCandidates(
    excludedIssueIds: ReadonlySet<string>,
    limit?: number,
    scope?: IssueCandidateScope,
  ): Promise<IssueRecord[]> {
    const candidateLimit = limit === undefined ? undefined : normalizeLimit(limit);
    if (candidateLimit === 0) return [];

    const publicIssues = this.issues.filter(isPublicIssue);
    if (scope === undefined || candidateLimit === undefined) {
      const rows = publicIssues
        .filter((issue) => !excludedIssueIds.has(issue.id))
        .sort(compareIssue);
      return (candidateLimit === undefined ? rows : rows.slice(0, candidateLimit)).map(cloneIssue);
    }

    const rows: IssueRecord[] = [];
    const seenIds = new Set(excludedIssueIds);
    let remainingRows = candidateLimit;
    for (const slice of buildCandidateSlices(scope)) {
      if (remainingRows === 0) break;
      const sliceLimit = Math.min(
        remainingRows,
        Math.max(1, Math.floor(candidateLimit * slice.weight)),
      );
      const sliceRows = publicIssues
        .filter((issue) => !seenIds.has(issue.id) && slice.matches(issue))
        .sort(compareIssue)
        .slice(0, sliceLimit);
      for (const issue of sliceRows) {
        if (seenIds.has(issue.id)) continue;
        seenIds.add(issue.id);
        rows.push(issue);
        remainingRows -= 1;
      }
    }
    if (remainingRows > 0) {
      const fillRows = publicIssues
        .filter((issue) => !seenIds.has(issue.id))
        .sort(compareIssue)
        .slice(0, remainingRows);
      for (const issue of fillRows) {
        if (seenIds.has(issue.id)) continue;
        seenIds.add(issue.id);
        rows.push(issue);
        remainingRows -= 1;
        if (remainingRows === 0) break;
      }
    }

    const unique = new Map<string, IssueRecord>();
    for (const issue of rows) {
      if (!unique.has(issue.id)) unique.set(issue.id, issue);
    }
    return [...unique.values()].sort(compareIssue).slice(0, candidateLimit).map(cloneIssue);
  }

  async findIssue(id: string): Promise<IssueRecord | null> {
    const issue = this.issues.find((candidate) => candidate.id === id);
    return issue === undefined ? null : cloneIssue(issue);
  }

  async findIssuesByIds(ids: ReadonlySet<string>): Promise<IssueRecord[]> {
    return this.issues.filter((issue) => ids.has(issue.id)).map(cloneIssue);
  }

  async findUserContext(userId: string): Promise<UserRecommendationContext | null> {
    const context = this.contexts.get(userId);
    return context === undefined ? null : cloneContext(context);
  }

  async findLatestInteractions(userId: string): Promise<UserInteractionRecord[]> {
    const latest = new Map<string, UserInteractionRecord>();
    for (const interaction of this.interactions) {
      if (interaction.userId !== userId) continue;
      const previous = latest.get(interaction.issueId);
      if (previous === undefined || compareInteraction(interaction, previous) > 0) {
        latest.set(interaction.issueId, interaction);
      }
    }
    return [...latest.values()]
      .sort((left, right) => left.issueId.localeCompare(right.issueId))
      .map(cloneInteraction);
  }

  async findFollowUps(issueIds: ReadonlySet<string>): Promise<IssueRelationRecord[]> {
    return this.relations
      .filter(
        (relation) =>
          relation.relationType === 'FOLLOW_UP' &&
          Number.isFinite(relation.verifiedAt.getTime()) &&
          issueIds.has(relation.fromIssueId),
      )
      .map(cloneRelation);
  }

  /** Test/fixture helper. Production callers depend on the repository port only. */
  seed(seed: InMemoryIssueQuerySeed): void {
    if (seed.issues !== undefined) this.issues.push(...seed.issues.map(cloneIssue));
    for (const context of seed.contexts ?? [])
      this.contexts.set(context.userId, cloneContext(context));
    this.interactions.push(...(seed.interactions ?? []).map(cloneInteraction));
    this.relations.push(...(seed.relations ?? []).map(cloneRelation));
  }

  getStoredSession(id: string): FeedSessionRecord | undefined {
    const session = this.sessions.get(id);
    return session === undefined ? undefined : cloneSession(session);
  }
}

function batchKey(sessionId: string, batchNo: number): string {
  return `${sessionId}:${batchNo}`;
}

function sameOwner(left: FeedOwner, right: FeedOwner): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'MEMBER' && right.kind === 'MEMBER') {
    return left.userId === right.userId;
  }
  if (left.kind === 'GUEST' && right.kind === 'GUEST') {
    return left.guestTokenHash === right.guestTokenHash;
  }
  return false;
}

function compareInteraction(left: UserInteractionRecord, right: UserInteractionRecord): number {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime();
  return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
}

function compareIssue(left: IssueRecord, right: IssueRecord): number {
  const byImportance = clamp01(right.importanceScore) - clamp01(left.importanceScore);
  if (byImportance !== 0) return byImportance;
  const byFreshness = clamp01(right.freshnessScore) - clamp01(left.freshnessScore);
  if (byFreshness !== 0) return byFreshness;
  const leftEventAt = left.eventAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEventAt = right.eventAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (rightEventAt !== leftEventAt) return rightEventAt - leftEventAt;
  return left.id.localeCompare(right.id);
}

interface CandidateSlice {
  matches: (issue: IssueRecord) => boolean;
  weight: number;
}

function buildCandidateSlices(scope: IssueCandidateScope): CandidateSlice[] {
  const slices: CandidateSlice[] = [];
  const personalized = personalizedMatcher(scope);
  if (personalized !== null) slices.push({ matches: personalized, weight: 0.3 });

  const threshold = Math.min(1, Math.max(0, scope.highScoreThreshold));
  const major = (issue: IssueRecord): boolean =>
    scoreAtLeastAndAtMostOne(issue.importanceScore, threshold) ||
    scoreAtLeastAndAtMostOne(issue.freshnessScore, threshold);
  slices.push({ matches: major, weight: 0.2 });

  if (scope.connectedIssueIds.length > 0) {
    const connectedIds = new Set(scope.connectedIssueIds);
    slices.push({ matches: (issue) => connectedIds.has(issue.id), weight: 0.15 });
  }

  const excludedCategories = new Set(
    uniqueStrings([...scope.selectedCategoryCodes, ...scope.actedCategoryCodes]),
  );
  if (excludedCategories.size > 0) {
    slices.push({
      matches: (issue) => !excludedCategories.has(issue.categoryCode),
      weight: 0.2,
    });
  }

  const mismatch = mismatchMatcher(scope);
  if (personalized !== null && mismatch !== null) {
    slices.push({
      matches: (issue) => !personalized(issue) && mismatch(issue) && major(issue),
      weight: 0.15,
    });
  }
  return slices;
}

function personalizedMatcher(scope: IssueCandidateScope): ((issue: IssueRecord) => boolean) | null {
  const matchers: Array<(issue: IssueRecord) => boolean> = [];
  if (scope.selectedCategoryCodes.length > 0) {
    matchers.push((issue) => scope.selectedCategoryCodes.includes(issue.categoryCode));
  }
  if (scope.selectedEntityIds.length > 0) {
    matchers.push((issue) => issue.entityIds.some((id) => scope.selectedEntityIds.includes(id)));
  }
  if (scope.preferredRegionCodes.length > 0) {
    matchers.push((issue) =>
      issue.regionCodes.some((code) => scope.preferredRegionCodes.includes(code)),
    );
  }
  if (scope.ageGroup !== null) {
    matchers.push((issue) => issue.ageGroups.includes(scope.ageGroup!));
  }
  return matchers.length === 0 ? null : (issue) => matchers.some((matches) => matches(issue));
}

function mismatchMatcher(scope: IssueCandidateScope): ((issue: IssueRecord) => boolean) | null {
  const matchers: Array<(issue: IssueRecord) => boolean> = [];
  if (scope.selectedCategoryCodes.length > 0) {
    matchers.push((issue) => !scope.selectedCategoryCodes.includes(issue.categoryCode));
  }
  if (scope.selectedEntityIds.length > 0) {
    matchers.push(
      (issue) =>
        issue.entityIds.length > 0 &&
        !issue.entityIds.some((id) => scope.selectedEntityIds.includes(id)),
    );
  }
  if (scope.preferredRegionCodes.length > 0) {
    matchers.push(
      (issue) =>
        issue.regionCodes.length > 0 &&
        !issue.regionCodes.some((code) => scope.preferredRegionCodes.includes(code)),
    );
  }
  if (scope.ageGroup !== null) {
    matchers.push(
      (issue) => issue.ageGroups.length > 0 && !issue.ageGroups.includes(scope.ageGroup!),
    );
  }
  return matchers.length === 0 ? null : (issue) => matchers.some((matches) => matches(issue));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function scoreAtLeastAndAtMostOne(value: number, threshold: number): boolean {
  return value >= threshold && value <= 1;
}

function isPublicIssue(issue: IssueRecord): boolean {
  return (
    issue.publicationStatus === 'PUBLISHED' &&
    issue.integratedSummary !== null &&
    Array.isArray(issue.summaryLines) &&
    issue.summaryLines.length === 3
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function cloneIssue(issue: IssueRecord): IssueRecord {
  return {
    ...issue,
    eventAt: cloneDate(issue.eventAt),
    publishedAt: cloneDate(issue.publishedAt),
    updatedAt: new Date(issue.updatedAt),
    entityIds: [...issue.entityIds],
    regionCodes: [...issue.regionCodes],
    ageGroups: [...issue.ageGroups],
    summaryLines: [...issue.summaryLines],
    viewpoints:
      issue.viewpoints?.map((item) => ({ ...item, articleIds: [...item.articleIds] })) ?? null,
    glossary: issue.glossary.map((item) => ({ ...item, articleIds: [...item.articleIds] })),
    articles: issue.articles.map((article) => ({
      ...article,
      publishedAt: cloneDate(article.publishedAt),
    })),
    impacts: issue.impacts.map((impact) => ({ ...impact })),
  };
}

function cloneContext(context: UserRecommendationContext): UserRecommendationContext {
  return {
    ...context,
    selectedCategoryCodes: [...context.selectedCategoryCodes],
    selectedEntityIds: [...context.selectedEntityIds],
    preferredRegionCodes: [...context.preferredRegionCodes],
  };
}

function cloneInteraction(interaction: UserInteractionRecord): UserInteractionRecord {
  return { ...interaction, createdAt: new Date(interaction.createdAt) };
}

function cloneRelation(relation: IssueRelationRecord): IssueRelationRecord {
  return { ...relation, verifiedAt: new Date(relation.verifiedAt) };
}

function cloneSession(session: FeedSessionRecord): FeedSessionRecord {
  return {
    ...session,
    owner: { ...session.owner },
    createdAt: new Date(session.createdAt),
    expiresAt: new Date(session.expiresAt),
  };
}

function cloneBatch(batch: FeedBatchRecord): FeedBatchRecord {
  return {
    ...batch,
    createdAt: new Date(batch.createdAt),
    items: batch.items.map((item) => ({ ...item, reasonCodes: [...item.reasonCodes] })),
  };
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value);
}
