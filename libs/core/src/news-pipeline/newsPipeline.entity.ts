import { EntitySchema } from '@mikro-orm/core';

interface NewsRun {
  id: string;
  owner: string;
  status: string;
  snapshot: unknown;
  errorCode: string | null;
  heartbeatAt: Date;
  finishedAt: Date | null;
}
export interface NewsDiscoveryRun extends NewsRun {
  day: string;
}
export interface NewsCollectionRun extends NewsRun {
  discoveryRunId: string;
}
const runProperties = {
  id: { type: String, columnType: 'uuid', primary: true },
  owner: { type: String, columnType: 'uuid' },
  status: { type: String },
  snapshot: { type: 'jsonb' },
  errorCode: { type: String, fieldName: 'error_code', nullable: true },
  heartbeatAt: { type: Date, columnType: 'timestamptz', fieldName: 'heartbeat_at' },
  finishedAt: { type: Date, columnType: 'timestamptz', fieldName: 'finished_at', nullable: true },
} as const;
export const NewsDiscoveryRunSchema = new EntitySchema<NewsDiscoveryRun>({
  name: 'NewsDiscoveryRun',
  tableName: 'news_discovery_runs',
  properties: { ...runProperties, day: { type: 'date', unique: true } },
});
export const NewsCollectionRunSchema = new EntitySchema<NewsCollectionRun>({
  name: 'NewsCollectionRun',
  tableName: 'news_collection_runs',
  properties: {
    ...runProperties,
    discoveryRunId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'discovery_run_id',
      unique: true,
    },
  },
});
export interface NewsIssueSearch {
  issueId: string;
  title: string;
  publishedAt: Date;
}
export const NewsIssueSearchSchema = new EntitySchema<NewsIssueSearch>({
  name: 'NewsIssueSearch',
  tableName: 'news_issue_search',
  properties: {
    issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id', primary: true },
    title: { type: String },
    publishedAt: { type: Date, columnType: 'timestamptz', fieldName: 'published_at' },
  },
});
export interface NewsTerm {
  normalizedTerm: string;
  term: string;
  definition: string;
}
export const NewsTermSchema = new EntitySchema<NewsTerm>({
  name: 'NewsTerm',
  tableName: 'news_terms',
  properties: {
    normalizedTerm: { type: String, fieldName: 'normalized_term', primary: true },
    term: { type: String },
    definition: { type: String },
  },
});
// Registered only by standalone news CLIs; existing API registration is unchanged.
export const NEWS_PIPELINE_ENTITIES = [
  NewsDiscoveryRunSchema,
  NewsCollectionRunSchema,
  NewsIssueSearchSchema,
  NewsTermSchema,
];
