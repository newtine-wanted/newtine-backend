import { EntitySchema } from '@mikro-orm/core';

import { UserInteractionEventSchema } from '../../interest/persistence/interest.persistence.entity.js';
import { IssueSchema, type Issue } from './issue.persistence.entity.js';

export interface FeedSessionPersistenceEntity {
  id: string;
  userId: string | null;
  guestTokenHash: string | null;
  algorithmVersion: string;
  candidateBudget: number;
  highScoreThreshold: number;
  nextBatchNo: number;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  lastTopic: string | null;
  lastRepresentativeEntityId: string | null;
  topicRun: number;
  entityRun: number;
}

export const FeedSessionEntity = new EntitySchema<FeedSessionPersistenceEntity>({
  name: 'FeedSession',
  tableName: 'feed_sessions',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    userId: { type: String, columnType: 'uuid', fieldName: 'user_id', nullable: true },
    guestTokenHash: { type: String, fieldName: 'guest_token_hash', nullable: true },
    algorithmVersion: { type: String, fieldName: 'algorithm_version' },
    candidateBudget: { type: Number, columnType: 'integer', fieldName: 'candidate_budget' },
    highScoreThreshold: { type: Number, columnType: 'numeric', fieldName: 'high_score_threshold' },
    nextBatchNo: { type: Number, fieldName: 'next_batch_no' },
    status: { type: String },
    createdAt: { type: Date, columnType: 'timestamptz', fieldName: 'created_at' },
    expiresAt: { type: Date, columnType: 'timestamptz', fieldName: 'expires_at' },
    lastTopic: { type: String, fieldName: 'last_topic', nullable: true },
    lastRepresentativeEntityId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'last_representative_entity_id',
      nullable: true,
    },
    topicRun: { type: Number, fieldName: 'topic_run' },
    entityRun: { type: Number, fieldName: 'entity_run' },
  },
});

export interface FeedBatchPersistenceEntity {
  feedSessionId: string;
  batchNo: number;
  continuation: string;
  createdAt: Date;
}

export const FeedBatchEntity = new EntitySchema<FeedBatchPersistenceEntity>({
  name: 'FeedBatch',
  tableName: 'feed_batches',
  properties: {
    feedSessionId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'feed_session_id',
      primary: true,
    },
    batchNo: { type: Number, fieldName: 'batch_no', primary: true },
    continuation: { type: String },
    createdAt: { type: Date, columnType: 'timestamptz', fieldName: 'created_at' },
  },
});

export interface FeedBatchItemPersistenceEntity {
  feedSessionId: string;
  batchNo: number;
  position: number;
  issueId: string;
  selectionType: string;
  reasonCodes: unknown;
}

export const FeedBatchItemEntity = new EntitySchema<FeedBatchItemPersistenceEntity>({
  name: 'FeedBatchItem',
  tableName: 'feed_batch_items',
  properties: {
    feedSessionId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'feed_session_id',
      primary: true,
    },
    batchNo: { type: Number, fieldName: 'batch_no', primary: true },
    position: { type: Number, primary: true },
    issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id' },
    selectionType: { type: String, fieldName: 'selection_type' },
    reasonCodes: { type: 'jsonb', fieldName: 'reason_codes' },
  },
});

export type IssueQueryIssuePersistenceEntity = Issue;

export const IssueQueryIssueEntity = IssueSchema;
export interface IssueQueryDetailPersistenceEntity {
  id: string;
  issueId: string;
  integratedSummary: string | null;
  summaryLines: unknown;
  viewpoints: unknown;
  glossary: unknown;
}

export const IssueQueryDetailEntity = new EntitySchema<IssueQueryDetailPersistenceEntity>({
  name: 'IssueQueryDetail',
  tableName: 'issue_details',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id', unique: true },
    integratedSummary: { type: String, fieldName: 'integrated_summary', nullable: true },
    summaryLines: { type: 'jsonb', fieldName: 'summary_lines' },
    viewpoints: { type: 'jsonb', nullable: true },
    glossary: { type: 'jsonb' },
  },
});

export interface IssueQueryImpactPersistenceEntity {
  id: string;
  issueId: string;
  targetType: string;
  targetValue: string;
  description: string;
  articleIds: unknown;
}

export const IssueQueryImpactEntity = new EntitySchema<IssueQueryImpactPersistenceEntity>({
  name: 'IssueQueryImpact',
  tableName: 'issue_impacts',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id' },
    targetType: { type: String, fieldName: 'target_type' },
    targetValue: { type: String, fieldName: 'target_value' },
    description: { type: String },
    articleIds: { type: 'jsonb', fieldName: 'article_ids' },
  },
});

export interface IssueQueryArticleLinkPersistenceEntity {
  issueId: string;
  articleId: string;
  sortOrder: number | null;
}

export const IssueQueryArticleLinkEntity = new EntitySchema<IssueQueryArticleLinkPersistenceEntity>(
  {
    name: 'IssueQueryArticleLink',
    tableName: 'issue_articles',
    properties: {
      issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id', primary: true },
      articleId: { type: String, columnType: 'uuid', fieldName: 'article_id', primary: true },
      sortOrder: { type: Number, fieldName: 'sort_order', nullable: true },
    },
  },
);

export interface IssueQueryArticlePersistenceEntity {
  id: string;
  publisherId: string | null;
  title: string;
  articleUrl: string;
  publisherName: string;
  publishedAt: Date | null;
  sourceStatus: string;
}

export const IssueQueryArticleEntity = new EntitySchema<IssueQueryArticlePersistenceEntity>({
  name: 'IssueQueryArticle',
  tableName: 'articles',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    publisherId: { type: String, columnType: 'uuid', fieldName: 'publisher_id', nullable: true },
    title: { type: String },
    articleUrl: { type: String, fieldName: 'article_url' },
    publisherName: { type: String, fieldName: 'publisher_name' },
    publishedAt: {
      type: Date,
      columnType: 'timestamptz',
      fieldName: 'published_at',
      nullable: true,
    },
    sourceStatus: { type: String, fieldName: 'source_status' },
  },
});

export interface IssueQueryPublisherPersistenceEntity {
  id: string;
  name: string;
}

export const IssueQueryPublisherEntity = new EntitySchema<IssueQueryPublisherPersistenceEntity>({
  name: 'IssueQueryPublisher',
  tableName: 'publishers',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    name: { type: String },
  },
});

export interface IssueQueryEntityLinkPersistenceEntity {
  issueEntitiesId: string;
  issueId: string;
  entityId: string;
}

export const IssueQueryEntityLinkEntity = new EntitySchema<IssueQueryEntityLinkPersistenceEntity>({
  name: 'IssueQueryEntityLink',
  tableName: 'issue_entities',
  properties: {
    issueEntitiesId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'issue_entities_id',
      primary: true,
    },
    issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id' },
    entityId: { type: String, columnType: 'uuid', fieldName: 'entity_id' },
  },
});

export interface IssueQueryRelationPersistenceEntity {
  fromIssueId: string;
  toIssueId: string;
  relationType: string;
  reason: string;
  evidenceRefs: unknown;
  verifiedAt: Date;
}

export const IssueQueryRelationEntity = new EntitySchema<IssueQueryRelationPersistenceEntity>({
  name: 'IssueQueryRelation',
  tableName: 'issue_relations',
  properties: {
    fromIssueId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'from_issue_id',
      primary: true,
    },
    toIssueId: { type: String, columnType: 'uuid', fieldName: 'to_issue_id', primary: true },
    relationType: { type: String, fieldName: 'relation_type', primary: true },
    reason: { type: String },
    evidenceRefs: { type: 'jsonb', fieldName: 'evidence_refs' },
    verifiedAt: { type: Date, columnType: 'timestamptz', fieldName: 'verified_at' },
  },
});

export interface IssueQueryInteractionPersistenceEntity {
  id: string;
  userId: string;
  issueId: string;
  eventType: string;
  acceptedOrder: number;
  createdAt: Date;
}

export const IssueQueryInteractionEntity = UserInteractionEventSchema;
/** Entity metadata consumed by the shared MikroORM configuration. */
export const ISSUE_QUERY_PERSISTENCE_ENTITIES = [
  FeedSessionEntity,
  FeedBatchEntity,
  FeedBatchItemEntity,
  IssueQueryDetailEntity,
  IssueQueryImpactEntity,
  IssueQueryArticleLinkEntity,
  IssueQueryArticleEntity,
  IssueQueryPublisherEntity,
  IssueQueryEntityLinkEntity,
  IssueQueryRelationEntity,
] as const satisfies readonly EntitySchema[];
