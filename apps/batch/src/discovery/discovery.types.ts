import type { DiscoveredArticle } from '@newtine/core';

export interface DiscoveryConfig {
  articlesPerQuery: number;
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
  title: string;
  articles: DiscoveredArticle[];
  queries: string[];
  origins: string[];
  parentIssueIds: string[];
  mergedCandidateIds: string[];
}
export interface QueryResult {
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
  catalog(since: string): Promise<SearchQuery[]>;
  tracks(at: string): Promise<TrackingIssue[]>;
  save(run: DiscoveryRun): Promise<void>;
  heartbeat(run: DiscoveryRun): Promise<void>;
  complete(run: DiscoveryRun): Promise<void>;
  fail(run: DiscoveryRun, reason: string): Promise<void>;
}
export interface DiscoveryModel {
  usage?: DiscoverySnapshot['usage'];
  extract(titles: string[], limit: number): Promise<{ title: string; titleIndexes: number[] }[]>;
  groups(titles: string[]): Promise<number[][]>;
  newDevelopments(knownTitles: string[], titles: string[]): Promise<number[]>;
}
