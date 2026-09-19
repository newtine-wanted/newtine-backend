import type { FetchedArticle } from '@newtine/core';
import type { CollectionResult } from '../collection/collection.types.js';
import type { DiscoverySnapshot } from '../discovery/discovery.types.js';

export const GENERATIONS = ['AGE_19_34', 'AGE_35_49', 'AGE_50_64', 'AGE_65_PLUS'] as const;
export type Generation = (typeof GENERATIONS)[number];
export type Usage = DiscoverySnapshot['usage'][number] & { cachedInputTokens?: number };
export interface CatalogEntry {
  code: string;
  name: string;
}
export interface Catalog {
  topics: CatalogEntry[];
  regions: CatalogEntry[];
  entities: CatalogEntry[];
}
export type Classification = Record<keyof Catalog, string[]> & { generations: Generation[] };
export interface GenerationConfig {
  bodyCharacters: number;
  freshnessHalfLifeHours: number;
  maxTrackingDays: number;
}
export interface Draft {
  title: string;
  eventAt: string | null;
  eventEvidence: string | null;
  integratedSummary: string;
  summaryLines: string[];
  viewpoints: { stakeholder: string; statement: string; articleIds: string[] }[] | null;
  impacts: { generation: Generation; description: string; articleIds: string[] }[];
  llmEstimatedImportance: number;
  importanceReason: string;
  generations: Generation[];
  terms: string[];
  followUp: { enabled: boolean; days: number; queries: string[]; reason: string };
}
export interface TermDefinition {
  term: string;
  definition: string;
  source: 'DATABASE' | 'GENERATED';
}
export interface GenerationResult {
  source: CollectionResult;
  articles: FetchedArticle[];
  fetchFailures: string[];
  draft?: Draft;
  rules?: Omit<Classification, 'generations'>;
  classification?: Classification;
  glossary?: TermDefinition[];
  scores?: {
    importance: number;
    freshness: number;
    articleCount: number;
    publisherCount: number;
    llmEstimatedImportance: number;
    at: string;
  };
  eventAt?: string;
  eventAtSource?: 'ARTICLE_EVENT' | 'FIRST_REPORT';
  status?: 'GENERATED' | 'INSUFFICIENT_BODIES';
}
export interface GenerationSnapshot {
  at: string;
  config: GenerationConfig;
  catalog?: Catalog;
  results: GenerationResult[];
  usage: Usage[];
}
export interface GenerationRun {
  id: string;
  collectionRunId: string;
  owner: string;
  completed: boolean;
  snapshot: GenerationSnapshot;
}
export interface GenerationStore {
  claim(source: string, at: Date, config: GenerationConfig): Promise<GenerationRun>;
  catalog(): Promise<Catalog>;
  terms(names: string[]): Promise<TermDefinition[]>;
  save(run: GenerationRun): Promise<void>;
  heartbeat(run: GenerationRun): Promise<void>;
  complete(run: GenerationRun): Promise<void>;
  fail(run: GenerationRun, reason: string): Promise<void>;
}
export interface GenerationModel {
  usage: Usage[];
  generate(articles: FetchedArticle[], config: GenerationConfig): Promise<Draft>;
  classify(
    draft: Draft,
    articles: FetchedArticle[],
    unresolved: Partial<Catalog>,
  ): Promise<Omit<Classification, 'generations'>>;
  define(terms: string[], draft: Draft): Promise<TermDefinition[]>;
}
