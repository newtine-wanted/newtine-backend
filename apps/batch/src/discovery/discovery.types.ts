import type { DiscoveredArticle } from '@newtine/core';

export interface DiscoveryConfig {
  articlesPerQuery: number;
  /** Maximum for topic-only searches; all other searches use one. */
  candidatesPerQuery: number;
  maxQueries: number;
  maxCandidates: number;
  entityTypes: string[];
}
export interface SearchQuery {
  text: string;
  origins: string[];
  parentIssueId?: string;
  since: string;
}
export interface TrackingIssue {
  issueId: string;
  title: string;
  keywords: string[];
  lastCheckedAt: string;
  expiresAt: string;
  knownTitles: string[];
}
export interface Candidate {
  id: string;
  /** Concise news search phrase for stage 2, not an article headline or display title. */
  title: string;
  /** Explicit event anchor chosen by the model; absent only in legacy snapshots. */
  representativeArticle?: DiscoveredArticle;
  articles: DiscoveredArticle[];
  queries: string[];
  origins: string[];
  parentIssueIds: string[];
  mergedCandidateIds: string[];
}
export interface QueryResult {
  /** Applied extraction cap; absent in legacy region-only policy snapshots. */
  candidateLimit?: number;
  query: SearchQuery;
  articles: DiscoveredArticle[];
  candidates: Candidate[];
}
export interface DiscoverySnapshot {
  at: string;
  config: DiscoveryConfig;
  queries?: SearchQuery[];
  tracks?: TrackingIssue[];
  results: QueryResult[];
  candidates?: Candidate[];
  excludedCandidates?: { candidate: Candidate; reason: 'IRRELEVANT' | 'HYPERLOCAL' }[];
  usage: { stage: string; model: string; inputTokens?: number; outputTokens?: number }[];
}
export interface DiscoveryRun {
  id: string;
  day: string;
  owner: string;
  snapshot: DiscoverySnapshot;
  completed: boolean;
}
export interface DiscoveryStore {
  claim(at: Date, config: DiscoveryConfig): Promise<DiscoveryRun>;
  catalog(since: string, entityTypes?: string[]): Promise<SearchQuery[]>;
  tracks(at: string): Promise<TrackingIssue[]>;
  save(run: DiscoveryRun): Promise<void>;
  heartbeat(run: DiscoveryRun): Promise<void>;
  complete(run: DiscoveryRun): Promise<void>;
  fail(run: DiscoveryRun, reason: string): Promise<void>;
}
export interface DiscoveryModel {
  excludedCandidates?: { index: number; reason: 'IRRELEVANT' | 'HYPERLOCAL' }[];
  usage?: DiscoverySnapshot['usage'];
  extract(
    titles: string[],
    limit: number,
  ): Promise<{ title: string; titleIndexes: number[]; representativeTitleIndex: number }[]>;
  groups(titles: string[]): Promise<number[][]>;
  newDevelopments(knownTitles: string[], titles: string[]): Promise<number[]>;
}
