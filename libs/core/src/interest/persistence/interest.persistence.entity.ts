import { EntitySchema, type EntitySchema as EntitySchemaType } from '@mikro-orm/core';

export interface UserInteractionEventPersistenceEntity {
  id: string;
  userId: string;
  issueId: string;
  sessionId: string;
  eventType: string;
  dwellTime: number | null;
  previousAction: string | null;
  acceptedOrder: number;
  createdAt: Date;
}

/** Append-only interaction events used to derive a user's current interests. */
export const UserInteractionEventSchema = new EntitySchema<UserInteractionEventPersistenceEntity>({
  name: 'UserInteractionEvent',
  tableName: 'user_interaction_events',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    userId: { type: String, columnType: 'uuid', fieldName: 'user_id' },
    issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id' },
    sessionId: { type: String, columnType: 'uuid', fieldName: 'session_id' },
    eventType: { type: String, fieldName: 'event_type' },
    dwellTime: { type: Number, fieldName: 'dwell_time', nullable: true },
    previousAction: { type: String, fieldName: 'previous_action', nullable: true },
    acceptedOrder: { type: Number, columnType: 'bigint', fieldName: 'accepted_order' },
    createdAt: { type: Date, fieldName: 'created_at', columnType: 'timestamptz' },
  },
  indexes: [
    {
      name: 'user_interaction_events_user_issue_created_idx',
      properties: ['userId', 'issueId', 'createdAt'],
    },
    {
      name: 'user_interaction_events_user_created_idx',
      properties: ['userId', 'createdAt'],
    },
  ],
});

export interface UserIssueContributionPersistenceEntity {
  userId: string;
  issueId: string;
  categoryCode: string;
  actionScore: number;
  creditedDwellMilliseconds: number;
  dwellScore: number;
  lastActionEventId: string | null;
  updatedAt: Date;
}

/** Materialized per-issue contribution ledger; it is not the liked-issues read model. */
export const UserIssueContributionSchema = new EntitySchema<UserIssueContributionPersistenceEntity>(
  {
    name: 'UserIssueContribution',
    tableName: 'user_issue_contributions',
    properties: {
      userId: { type: String, columnType: 'uuid', fieldName: 'user_id', primary: true },
      issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id', primary: true },
      categoryCode: { type: String, fieldName: 'category_code' },
      actionScore: { type: Number, columnType: 'numeric', fieldName: 'action_score' },
      creditedDwellMilliseconds: {
        type: Number,
        fieldName: 'credited_dwell_ms',
      },
      dwellScore: { type: Number, columnType: 'numeric', fieldName: 'dwell_score' },
      lastActionEventId: {
        type: String,
        columnType: 'uuid',
        fieldName: 'last_action_event_id',
        nullable: true,
      },
      updatedAt: { type: Date, columnType: 'timestamptz', fieldName: 'updated_at' },
    },
  },
);

export interface IssueDetailViewPersistenceEntity {
  viewId: string;
  userId: string;
  issueId: string;
  sessionId: string;
  startedAt: Date;
  expiresAt: Date;
  activeMilliseconds: number;
}

/** Client-idempotent detail sheet sessions used to aggregate active time. */
export const IssueDetailViewSchema = new EntitySchema<IssueDetailViewPersistenceEntity>({
  name: 'IssueDetailView',
  tableName: 'issue_detail_views',
  properties: {
    viewId: { type: String, columnType: 'uuid', fieldName: 'view_id', primary: true },
    userId: { type: String, columnType: 'uuid', fieldName: 'user_id' },
    issueId: { type: String, columnType: 'uuid', fieldName: 'issue_id' },
    sessionId: { type: String, columnType: 'uuid', fieldName: 'session_id' },
    startedAt: { type: Date, columnType: 'timestamptz', fieldName: 'started_at' },
    expiresAt: { type: Date, columnType: 'timestamptz', fieldName: 'expires_at' },
    activeMilliseconds: { type: Number, fieldName: 'active_ms' },
  },
  indexes: [
    {
      name: 'issue_detail_views_user_issue_idx',
      properties: ['userId', 'issueId'],
    },
    {
      name: 'issue_detail_views_expires_at_idx',
      properties: ['expiresAt'],
    },
  ],
});

export const INTEREST_PERSISTENCE_ENTITIES = [
  UserInteractionEventSchema,
  UserIssueContributionSchema,
  IssueDetailViewSchema,
] as const satisfies readonly EntitySchemaType[];
