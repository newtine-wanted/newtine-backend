import { EntitySchema, type EntitySchema as EntitySchemaType } from '@mikro-orm/core';

export interface UserInteractionEventPersistenceEntity {
  id: string;
  userId: string;
  issueId: string;
  sessionId: string;
  eventType: string;
  dwellTime: number | null;
  previousAction: string | null;
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

export const INTEREST_PERSISTENCE_ENTITIES = [
  UserInteractionEventSchema,
] as const satisfies readonly EntitySchemaType[];
