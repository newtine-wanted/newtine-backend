import type { DiscoveredArticle } from '@newtine/core';
import type { Candidate, DiscoverySnapshot } from '../discovery/discovery.types.js';

export interface PublisherPriority {
  name: string;
  domains: string[];
  priority: number;
}
export interface CollectionConfig {
  articlesPerQuery: number;
  publishers: PublisherPriority[];
}
export interface SimilarIssue {
  id: string;
  title: string;
  similarity: number;
}
export interface CollectionResult {
  candidate: Candidate;
  existingIssues?: SimilarIssue[];
  /** Empty means the model found no duplicate (or there were no comparison targets). */
  duplicateIssueIds?: string[];
  articles?: DiscoveredArticle[];
  relevantIndexes?: number[];
  selectedArticles?: DiscoveredArticle[];
  status?: 'DUPLICATE' | 'INSUFFICIENT_ARTICLES' | 'SELECTED';
}
export interface CollectionSnapshot {
  at: string;
  config: CollectionConfig;
  results: CollectionResult[];
  usage: DiscoverySnapshot['usage'];
}
export interface CollectionRun {
  id: string;
  discoveryRunId: string;
  owner: string;
  completed: boolean;
  snapshot: CollectionSnapshot;
}
export interface CollectionStore {
  claim(discoveryRunId: string, at: Date, config: CollectionConfig): Promise<CollectionRun>;
  similar(title: string, at: string): Promise<SimilarIssue[]>;
  save(run: CollectionRun): Promise<void>;
  heartbeat(run: CollectionRun): Promise<void>;
  complete(run: CollectionRun): Promise<void>;
  fail(run: CollectionRun, reason: string): Promise<void>;
}
export interface CollectionModel {
  usage?: DiscoverySnapshot['usage'];
  duplicates(candidate: Candidate, issues: SimilarIssue[]): Promise<number[]>;
  relevant(candidate: Candidate, articles: DiscoveredArticle[]): Promise<number[]>;
}
