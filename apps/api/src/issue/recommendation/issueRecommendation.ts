import type {
  AgeGroup,
  FeedBatchItemRecord,
  FeedContinuation,
  FeedSessionRecord,
  IssueRecord,
  IssueSelectionType,
  UserInteractionRecord,
  UserRecommendationContext,
} from '@newtine/core';

export const ISSUE_RECOMMENDATION_ALGORITHM_VERSION = 'issue-card-query-v1';
export const DEFAULT_HIGH_SCORE_THRESHOLD = 0.7;
export const DEFAULT_CANDIDATE_BUDGET = 100;
export const FEED_BATCH_SIZE = 10;
const MAX_ALTERNATIVE_ROUNDS = 3;
const MAX_REPLACEMENTS_PER_ALTERNATIVE = 2;

export const SELECTION_TARGETS: ReadonlyArray<readonly [IssueSelectionType, number]> = [
  ['PERSONALIZED', 4],
  ['MAJOR', 2],
  ['CONNECTED', 1],
  ['EXPLORATION', 2],
  ['OPPOSITE', 1],
];

export interface RecommendationCandidate {
  issue: IssueRecord;
  score: number;
  eligibleTypes: IssueSelectionType[];
  reasonCodes: string[];
}

export interface RecommendationInput {
  issues: IssueRecord[];
  context: UserRecommendationContext | null;
  latestInteractions: UserInteractionRecord[];
  actedCategoryCodes: ReadonlySet<string>;
  connectedIssueIds: ReadonlySet<string>;
  previousSession: Pick<
    FeedSessionRecord,
    'lastTopic' | 'lastRepresentativeEntityId' | 'topicRun' | 'entityRun'
  >;
  highScoreThreshold?: number;
  candidateBudget?: number;
}

export interface RecommendationOutput {
  items: FeedBatchItemRecord[];
  continuation: FeedContinuation;
  lastTopic: string | null;
  lastRepresentativeEntityId: string | null;
  topicRun: number;
  entityRun: number;
}

export function recommendFeed(input: RecommendationInput): RecommendationOutput {
  const threshold = input.highScoreThreshold ?? DEFAULT_HIGH_SCORE_THRESHOLD;
  const budget = input.candidateBudget ?? DEFAULT_CANDIDATE_BUDGET;
  const pool = input.issues.slice(0, Math.max(0, budget));
  const scored = pool
    .map((issue) => scoreCandidate(issue, input, threshold))
    .filter((candidate): candidate is RecommendationCandidate => candidate !== null);
  const selected = selectByTarget(scored);
  const orderedResult = orderWithAlternatives(selected, scored, input.previousSession);
  const ordered = orderedResult.items;
  const outputItems = ordered.slice(0, FEED_BATCH_SIZE).map((candidate, index) => ({
    issueId: candidate.issue.id,
    position: index + 1,
    selectionType: candidate.selectedType,
    reasonCodes: candidate.reasonCodes,
  }));

  const continuation = resolveContinuation({
    candidateCount: input.issues.length,
    budget,
    selectedCount: selected.length,
    orderedCount: ordered.length,
    poolCount: pool.length,
    alternativeSearchLimited: orderedResult.searchLimited,
  });
  return { ...orderedResult.state, items: outputItems, continuation };
}

interface SelectedCandidate extends RecommendationCandidate {
  selectedType: IssueSelectionType;
}

type RunState = RecommendationInput['previousSession'];

interface SearchState extends RunState {
  /** Capped counts make quota satisfaction part of the memoized state. */
  quotaCounts: number[];
}

interface SearchResult {
  items: SelectedCandidate[];
  state: SearchState;
}

function scoreCandidate(
  issue: IssueRecord,
  input: RecommendationInput,
  threshold: number,
): RecommendationCandidate | null {
  const context = input.context;
  const categoryMatch = context?.selectedCategoryCodes.includes(issue.categoryCode) === true;
  const entityMatch =
    context !== null && issue.entityIds.some((id) => context.selectedEntityIds.includes(id));
  const regionMatch =
    context !== null &&
    issue.regionCodes.some((code) => context.preferredRegionCodes.includes(code));
  const ageMatch =
    context?.ageGroup !== null && context?.ageGroup !== undefined
      ? issue.ageGroups.includes(context.ageGroup)
      : false;
  const connected = input.connectedIssueIds.has(issue.id);
  const knownMismatch = hasKnownMismatch(issue, context);
  const highImportance = scoreAtLeast(issue.importanceScore, threshold);
  const highFreshness = scoreAtLeast(issue.freshnessScore, threshold);
  const personalized = categoryMatch || entityMatch || regionMatch || ageMatch;
  const actedCategory = input.actedCategoryCodes.has(issue.categoryCode);
  const exploration = !categoryMatch && !actedCategory;
  const opposite =
    context !== null && !personalized && knownMismatch && (highImportance || highFreshness);
  const major = highImportance || highFreshness;
  const eligibleTypes: IssueSelectionType[] = [];
  if (personalized) eligibleTypes.push('PERSONALIZED');
  if (major) eligibleTypes.push('MAJOR');
  if (connected) eligibleTypes.push('CONNECTED');
  if (exploration) eligibleTypes.push('EXPLORATION');
  if (opposite) eligibleTypes.push('OPPOSITE');
  if (eligibleTypes.length === 0) return null;

  const reasonCodes: string[] = [];
  if (categoryMatch) reasonCodes.push('CATEGORY_MATCH');
  if (entityMatch) reasonCodes.push('ENTITY_MATCH');
  if (regionMatch) reasonCodes.push('REGION_MATCH');
  if (ageMatch) reasonCodes.push('AGE_GROUP_MATCH');
  if (connected) reasonCodes.push('FOLLOW_UP_LIKE');
  if (highImportance) reasonCodes.push('IMPORTANCE_HIGH');
  if (highFreshness) reasonCodes.push('FRESHNESS_HIGH');
  if (opposite) reasonCodes.push('KNOWN_MISMATCH');
  if (exploration) reasonCodes.push('NEW_TOPIC');

  const score = clamp01(
    (categoryMatch ? 0.25 : 0) +
      (entityMatch ? 0.2 : 0) +
      (connected ? 0.15 : 0) +
      (regionMatch ? 0.1 : 0) +
      (ageMatch ? 0.1 : 0) +
      clamp01(issue.importanceScore) * 0.1 +
      clamp01(issue.freshnessScore) * 0.1,
  );
  return { issue, score, eligibleTypes, reasonCodes };
}

function selectByTarget(candidates: RecommendationCandidate[]): SelectedCandidate[] {
  const priority = new Map(SELECTION_TARGETS.map(([type], index) => [type, index]));
  const byType = new Map<IssueSelectionType, RecommendationCandidate[]>();
  for (const [type] of SELECTION_TARGETS) byType.set(type, []);
  for (const candidate of candidates) {
    for (const type of candidate.eligibleTypes) byType.get(type)?.push(candidate);
  }
  for (const list of byType.values()) list.sort(compareCandidate);
  const slots = SELECTION_TARGETS.flatMap(([type, quota]) =>
    Array.from({ length: quota }, () => ({ type })),
  ).sort(
    (left, right) =>
      (byType.get(left.type)?.length ?? 0) - (byType.get(right.type)?.length ?? 0) ||
      priority.get(left.type)! - priority.get(right.type)!,
  );
  const candidateToSlot = new Map<string, number>();
  const candidateById = new Map(candidates.map((candidate) => [candidate.issue.id, candidate]));
  const tryAssign = (slotIndex: number, visited: Set<string>): boolean => {
    const slot = slots[slotIndex];
    if (slot === undefined) return false;
    for (const candidate of byType.get(slot.type) ?? []) {
      if (visited.has(candidate.issue.id)) continue;
      visited.add(candidate.issue.id);
      const previousSlot = candidateToSlot.get(candidate.issue.id);
      if (previousSlot === undefined || tryAssign(previousSlot, visited)) {
        candidateToSlot.set(candidate.issue.id, slotIndex);
        return true;
      }
    }
    return false;
  };
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    tryAssign(slotIndex, new Set());
  }

  const selected = new Map<string, SelectedCandidate>();
  for (const [issueId, slotIndex] of candidateToSlot) {
    const candidate = candidateById.get(issueId);
    const slot = slots[slotIndex];
    if (candidate !== undefined && slot !== undefined) {
      selected.set(issueId, { ...candidate, selectedType: slot.type });
    }
  }

  const fallbackCandidates = [...candidates].sort(compareCandidate);
  for (const candidate of fallbackCandidates) {
    if (selected.size >= FEED_BATCH_SIZE || selected.has(candidate.issue.id)) continue;
    const selectedType = preferredType(candidate.eligibleTypes, priority);
    if (selectedType === undefined) continue;
    selected.set(candidate.issue.id, { ...candidate, selectedType });
  }
  return [...selected.values()].sort(
    (left, right) =>
      (priority.get(left.selectedType) ?? 99) - (priority.get(right.selectedType) ?? 99) ||
      compareCandidate(left, right),
  );
}

function preferredType(
  types: IssueSelectionType[],
  priority: ReadonlyMap<IssueSelectionType, number>,
): IssueSelectionType | undefined {
  return types
    .slice()
    .sort((left, right) => (priority.get(left) ?? 99) - (priority.get(right) ?? 99))[0];
}

function orderWithAlternatives(
  selected: SelectedCandidate[],
  candidates: RecommendationCandidate[],
  previous: RecommendationInput['previousSession'],
): { items: SelectedCandidate[]; state: RunState; searchLimited: boolean } {
  const priority = new Map(SELECTION_TARGETS.map(([type], index) => [type, index]));
  let bestSelection = selected.slice();
  let best = orderWithoutViolatingRuns(bestSelection, previous);
  if (
    best.items.length >= FEED_BATCH_SIZE &&
    !hasAlternativeQuotaOpportunity(bestSelection, candidates)
  ) {
    return { ...best, searchLimited: false };
  }

  // Repeatedly swap in bounded alternatives. A single replacement is not
  // enough when the first ten candidates share one topic and the next ten do
  // not; the loop converges on the longest valid order without unbounded DFS.
  let searchLimited = false;
  for (let round = 0; round < MAX_ALTERNATIVE_ROUNDS; round += 1) {
    const selectedIds = new Set(bestSelection.map((candidate) => candidate.issue.id));
    const runLimited = best.items.length < bestSelection.length;
    const alternatives = candidates
      .filter((candidate) => !selectedIds.has(candidate.issue.id))
      .filter((candidate) => !runLimited || canImproveRunOrQuota(candidate, bestSelection))
      .sort(compareCandidate);
    let improved = false;
    const replacementCount = bestSelection.length >= FEED_BATCH_SIZE ? bestSelection.length : 0;
    for (const alternative of alternatives) {
      if (bestSelection.some((candidate) => candidate.issue.id === alternative.issue.id)) continue;
      if (replacementCount === 0) {
        const proposal = [
          ...bestSelection,
          {
            ...alternative,
            selectedType: preferredType(alternative.eligibleTypes, priority) ?? 'MAJOR',
          },
        ];
        const ordered = orderWithoutViolatingRuns(proposal, previous);
        if (isBetterOrder(ordered, best)) {
          best = ordered;
          bestSelection = proposal;
          improved = true;
        }
        continue;
      }
      const allReplacementIndexes = replacementCandidates(alternative, bestSelection, previous);
      if (
        allReplacementIndexes.length > MAX_REPLACEMENTS_PER_ALTERNATIVE &&
        best.items.length < FEED_BATCH_SIZE
      ) {
        // The bounded proposal cap means that the candidate budget was read,
        // but this alternative's complete replacement space was not proven.
        // Preserve that uncertainty for continuation classification instead
        // of claiming that the run constraint is exhaustive.
        searchLimited = true;
      }
      const replacementIndexes = allReplacementIndexes.slice(0, MAX_REPLACEMENTS_PER_ALTERNATIVE);
      for (const index of replacementIndexes) {
        if (bestSelection.some((candidate) => candidate.issue.id === alternative.issue.id)) break;
        const removed = bestSelection[index];
        if (removed === undefined) continue;
        const selectedType = alternative.eligibleTypes.includes(removed.selectedType)
          ? removed.selectedType
          : preferredType(alternative.eligibleTypes, priority);
        if (selectedType === undefined || !alternative.eligibleTypes.includes(selectedType))
          continue;
        const proposal = bestSelection.slice();
        proposal[index] = { ...alternative, selectedType };
        const ordered = orderWithoutViolatingRuns(proposal, previous);
        if (isBetterOrder(ordered, best)) {
          best = ordered;
          bestSelection = proposal;
          improved = true;
          break;
        }
      }
    }
    // Once the maximum batch length is valid, stop scanning replacements. This
    // keeps the full candidate-budget scan bounded without re-running the
    // permutation search for equivalent lower-ranked alternatives.
    if (!improved || best.items.length >= FEED_BATCH_SIZE) break;
    if (round === MAX_ALTERNATIVE_ROUNDS - 1) searchLimited = true;
  }
  return { ...best, searchLimited };
}

function replacementCandidates(
  alternative: RecommendationCandidate,
  selected: SelectedCandidate[],
  previous: RecommendationInput['previousSession'],
): number[] {
  const topicCounts = new Map<string, number>();
  const entityCounts = new Map<string, number>();
  for (const candidate of selected) {
    if (candidate.issue.mainTopic !== null) {
      topicCounts.set(
        candidate.issue.mainTopic,
        (topicCounts.get(candidate.issue.mainTopic) ?? 0) + 1,
      );
    }
    if (candidate.issue.representativeEntityId !== null) {
      entityCounts.set(
        candidate.issue.representativeEntityId,
        (entityCounts.get(candidate.issue.representativeEntityId) ?? 0) + 1,
      );
    }
  }
  return selected
    .map((candidate, index) => ({
      index,
      priority:
        (candidate.issue.mainTopic !== null &&
        (topicCounts.get(candidate.issue.mainTopic) ?? 0) >= 2
          ? 4
          : 0) +
        (candidate.issue.representativeEntityId !== null &&
        (entityCounts.get(candidate.issue.representativeEntityId) ?? 0) >= 2
          ? 4
          : 0) +
        (candidate.issue.mainTopic !== null &&
        candidate.issue.mainTopic === previous.lastTopic &&
        previous.topicRun >= 2
          ? 2
          : 0) +
        (candidate.issue.representativeEntityId !== null &&
        candidate.issue.representativeEntityId === previous.lastRepresentativeEntityId &&
        previous.entityRun >= 2
          ? 2
          : 0) +
        (alternative.eligibleTypes.includes(candidate.selectedType) ? 1 : 0),
    }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(({ index }) => index);
}

function canImproveRunOrQuota(
  candidate: RecommendationCandidate,
  selected: SelectedCandidate[],
): boolean {
  if (selected.length === 0) return true;
  return selected.some((selectedCandidate) => {
    const topicCanBreak =
      candidate.issue.mainTopic === null
        ? selectedCandidate.issue.mainTopic !== null
        : selectedCandidate.issue.mainTopic !== null &&
          candidate.issue.mainTopic !== selectedCandidate.issue.mainTopic;
    const entityCanBreak =
      candidate.issue.representativeEntityId === null
        ? selectedCandidate.issue.representativeEntityId !== null
        : selectedCandidate.issue.representativeEntityId !== null &&
          candidate.issue.representativeEntityId !== selectedCandidate.issue.representativeEntityId;
    const quotaCanImprove = candidate.eligibleTypes.some(
      (type) => !selectedCandidate.eligibleTypes.includes(type),
    );
    return topicCanBreak || entityCanBreak || quotaCanImprove;
  });
}

function hasAlternativeQuotaOpportunity(
  selected: SelectedCandidate[],
  candidates: RecommendationCandidate[],
): boolean {
  const selectedIds = new Set(selected.map((candidate) => candidate.issue.id));
  const selectedTypes = new Set(selected.flatMap((candidate) => candidate.eligibleTypes));
  const currentQuota = quotaScore(selected);
  const quotaCapacity = SELECTION_TARGETS.reduce(
    (total, [type, quota]) => total + (selectedTypes.has(type) ? quota : 0),
    0,
  );
  if (currentQuota < quotaCapacity) return true;
  return candidates.some(
    (candidate) =>
      !selectedIds.has(candidate.issue.id) &&
      candidate.eligibleTypes.some((type) => !selectedTypes.has(type)),
  );
}

function isBetterOrder(
  candidate: { items: SelectedCandidate[]; state: RunState },
  current: { items: SelectedCandidate[]; state: RunState },
): boolean {
  if (candidate.items.length !== current.items.length)
    return candidate.items.length > current.items.length;
  const candidateQuota = quotaScore(candidate.items);
  const currentQuota = quotaScore(current.items);
  if (candidateQuota !== currentQuota) return candidateQuota > currentQuota;
  const candidateScore = candidate.items.reduce((sum, item) => sum + item.score, 0);
  const currentScore = current.items.reduce((sum, item) => sum + item.score, 0);
  if (candidateScore !== currentScore) return candidateScore > currentScore;
  return (
    candidate.items.map((item) => item.issue.id).join('|') <
    current.items.map((item) => item.issue.id).join('|')
  );
}

function quotaScore(items: SelectedCandidate[]): number {
  return SELECTION_TARGETS.reduce((total, [type, quota]) => {
    const count = items.filter((item) => item.selectedType === type).length;
    return total + Math.min(count, quota);
  }, 0);
}

function orderWithoutViolatingRuns(
  selected: SelectedCandidate[],
  previous: RecommendationInput['previousSession'],
): {
  items: SelectedCandidate[];
  state: RunState;
} {
  const candidates = selected.slice(0, FEED_BATCH_SIZE);
  const state: SearchState = {
    lastTopic: previous.lastTopic,
    lastRepresentativeEntityId: previous.lastRepresentativeEntityId,
    topicRun: previous.topicRun,
    entityRun: previous.entityRun,
    quotaCounts: SELECTION_TARGETS.map(() => 0),
  };
  const result = searchOrder(candidates, (1 << candidates.length) - 1, state, new Map());
  return { items: result.items, state: stripSearchState(result.state) };
}

function searchOrder(
  candidates: SelectedCandidate[],
  remainingMask: number,
  state: SearchState,
  memo: Map<string, SearchResult>,
): SearchResult {
  if (remainingMask === 0) return { items: [], state };
  const key = `${remainingMask}:${JSON.stringify(state)}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let best: SearchResult = { items: [], state };
  for (let index = 0; index < candidates.length; index += 1) {
    const bit = 1 << index;
    if ((remainingMask & bit) === 0) continue;
    const candidate = candidates[index];
    if (candidate === undefined || !canAppend(candidate.issue, state)) continue;
    const suffix = searchOrder(
      candidates,
      remainingMask ^ bit,
      advanceSearchState(candidate, state),
      memo,
    );
    const items = [candidate, ...suffix.items];
    const proposal = { items, state: suffix.state };
    if (isBetterSearchResult(proposal, best)) best = proposal;
  }
  memo.set(key, best);
  return best;
}

function isBetterSearchResult(candidate: SearchResult, current: SearchResult): boolean {
  if (candidate.items.length !== current.items.length) {
    return candidate.items.length > current.items.length;
  }
  const candidateQuota = quotaScoreFromCounts(candidate.state.quotaCounts);
  const currentQuota = quotaScoreFromCounts(current.state.quotaCounts);
  if (candidateQuota !== currentQuota) return candidateQuota > currentQuota;
  const candidateScore = candidate.items.reduce((sum, item) => sum + item.score, 0);
  const currentScore = current.items.reduce((sum, item) => sum + item.score, 0);
  if (candidateScore !== currentScore) return candidateScore > currentScore;
  return compareItemIds(candidate.items, current.items) < 0;
}

function quotaScoreFromCounts(counts: number[]): number {
  return SELECTION_TARGETS.reduce(
    (total, [, quota], index) => total + Math.min(counts[index] ?? 0, quota),
    0,
  );
}

function compareItemIds(left: SelectedCandidate[], right: SelectedCandidate[]): number {
  const leftIds = left.map((item) => item.issue.id).join('|');
  const rightIds = right.map((item) => item.issue.id).join('|');
  return leftIds.localeCompare(rightIds);
}

function advanceSearchState(candidate: SelectedCandidate, previous: SearchState): SearchState {
  const runState = advanceRunState(candidate.issue, previous);
  const quotaCounts = previous.quotaCounts.slice();
  const targetIndex = SELECTION_TARGETS.findIndex(([type]) => type === candidate.selectedType);
  const target = targetIndex < 0 ? undefined : SELECTION_TARGETS[targetIndex];
  if (target !== undefined) {
    quotaCounts[targetIndex] = Math.min((quotaCounts[targetIndex] ?? 0) + 1, target[1]);
  }
  return { ...runState, quotaCounts };
}

function stripSearchState(state: SearchState): RunState {
  return {
    lastTopic: state.lastTopic,
    lastRepresentativeEntityId: state.lastRepresentativeEntityId,
    topicRun: state.topicRun,
    entityRun: state.entityRun,
  };
}

function canAppend(issue: IssueRecord, state: RunState): boolean {
  const sameTopic = issue.mainTopic !== null && issue.mainTopic === state.lastTopic;
  const sameEntity =
    issue.representativeEntityId !== null &&
    issue.representativeEntityId === state.lastRepresentativeEntityId;
  return !(sameTopic && state.topicRun >= 2) && !(sameEntity && state.entityRun >= 2);
}

function advanceRunState(issue: IssueRecord, previous: RunState): RunState {
  return {
    lastTopic: issue.mainTopic,
    lastRepresentativeEntityId: issue.representativeEntityId,
    topicRun:
      issue.mainTopic !== null && issue.mainTopic === previous.lastTopic
        ? previous.topicRun + 1
        : issue.mainTopic === null
          ? 0
          : 1,
    entityRun:
      issue.representativeEntityId !== null &&
      issue.representativeEntityId === previous.lastRepresentativeEntityId
        ? previous.entityRun + 1
        : issue.representativeEntityId === null
          ? 0
          : 1,
  };
}

function resolveContinuation(input: {
  candidateCount: number;
  budget: number;
  selectedCount: number;
  orderedCount: number;
  poolCount: number;
  alternativeSearchLimited: boolean;
}): FeedContinuation {
  if (input.selectedCount === 0 && input.candidateCount === 0) return 'EXHAUSTED';
  const searchLimited = input.candidateCount > input.budget || input.alternativeSearchLimited;
  if (input.orderedCount < input.selectedCount) {
    return searchLimited ? 'SEARCH_LIMITED' : 'CONSTRAINT_LIMITED';
  }
  if (input.selectedCount < FEED_BATCH_SIZE && searchLimited) return 'SEARCH_LIMITED';
  if (input.selectedCount < FEED_BATCH_SIZE && input.poolCount < FEED_BATCH_SIZE)
    return 'EXHAUSTED';
  if (input.selectedCount < FEED_BATCH_SIZE) return 'CONSTRAINT_LIMITED';
  return 'CONTINUE';
}

function hasKnownMismatch(issue: IssueRecord, context: UserRecommendationContext | null): boolean {
  if (context === null) return false;
  const categoryKnown = context.selectedCategoryCodes.length > 0;
  const entityKnown = context.selectedEntityIds.length > 0;
  const regionKnown = context.preferredRegionCodes.length > 0;
  const ageKnown = context.ageGroup !== null;
  return (
    (categoryKnown &&
      issue.categoryCode !== '' &&
      !context.selectedCategoryCodes.includes(issue.categoryCode)) ||
    (entityKnown &&
      issue.entityIds.length > 0 &&
      !issue.entityIds.some((id) => context.selectedEntityIds.includes(id))) ||
    (regionKnown &&
      issue.regionCodes.length > 0 &&
      !issue.regionCodes.some((code) => context.preferredRegionCodes.includes(code))) ||
    (ageKnown &&
      issue.ageGroups.length > 0 &&
      !issue.ageGroups.includes(context.ageGroup as AgeGroup))
  );
}

function compareCandidate(left: RecommendationCandidate, right: RecommendationCandidate): number {
  const byScore = right.score - left.score;
  if (byScore !== 0) return byScore;
  const byFreshness = clamp01(right.issue.freshnessScore) - clamp01(left.issue.freshnessScore);
  if (byFreshness !== 0) return byFreshness;
  const byImportance = clamp01(right.issue.importanceScore) - clamp01(left.issue.importanceScore);
  if (byImportance !== 0) return byImportance;
  return left.issue.id.localeCompare(right.issue.id);
}

function scoreAtLeast(value: number, threshold: number): boolean {
  return Number.isFinite(value) && value >= threshold;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
