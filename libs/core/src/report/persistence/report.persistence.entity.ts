import { EntitySchema, type EntitySchema as EntitySchemaType } from '@mikro-orm/core';

import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

/**
 * Durable state for a member-requested weekly diagnostic report.
 *
 * The large request and result payloads are deliberately kept as JSONB.  The
 * lifecycle columns remain first-class columns because the worker claims and
 * fences work using SQL predicates rather than loading and mutating an ORM
 * entity in memory.
 */
export interface ReportPersistenceEntity {
  id: UuidV7;
  userId: UuidV7;
  periodStart: string;
  periodEnd: string;
  status: string;
  inputSnapshot: unknown;
  inputVersion: number;
  inputCapturedAt: Date;
  inputHash: string;
  candidates: unknown | null;
  content: unknown | null;
  attemptCount: number;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  leaseToken: UuidV7 | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  model: string | null;
  promptVersion: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  retryable: boolean;
}

export const ReportSchema = new EntitySchema<ReportPersistenceEntity>({
  name: 'Report',
  tableName: 'weekly_reports',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    userId: { type: String, columnType: 'uuid', fieldName: 'user_id' },
    periodStart: { type: String, columnType: 'date', fieldName: 'period_start' },
    periodEnd: { type: String, columnType: 'date', fieldName: 'period_end' },
    status: { type: String },
    inputSnapshot: { type: 'jsonb', fieldName: 'input_snapshot' },
    inputVersion: { type: Number, fieldName: 'input_version' },
    inputCapturedAt: {
      type: Date,
      columnType: 'timestamptz',
      fieldName: 'input_captured_at',
    },
    inputHash: { type: String, fieldName: 'input_hash' },
    candidates: { type: 'jsonb', nullable: true },
    content: { type: 'jsonb', nullable: true },
    attemptCount: { type: Number, fieldName: 'attempt_count' },
    nextAttemptAt: { type: Date, columnType: 'timestamptz', fieldName: 'next_attempt_at' },
    lastErrorCode: { type: String, fieldName: 'last_error_code', nullable: true },
    leaseToken: { type: String, columnType: 'uuid', fieldName: 'lease_token', nullable: true },
    leaseExpiresAt: {
      type: Date,
      columnType: 'timestamptz',
      fieldName: 'lease_expires_at',
      nullable: true,
    },
    heartbeatAt: {
      type: Date,
      columnType: 'timestamptz',
      fieldName: 'heartbeat_at',
      nullable: true,
    },
    model: { type: String, nullable: true },
    promptVersion: { type: String, fieldName: 'prompt_version', nullable: true },
    requestedAt: { type: Date, columnType: 'timestamptz', fieldName: 'requested_at' },
    startedAt: {
      type: Date,
      columnType: 'timestamptz',
      fieldName: 'started_at',
      nullable: true,
    },
    completedAt: {
      type: Date,
      columnType: 'timestamptz',
      fieldName: 'completed_at',
      nullable: true,
    },
    updatedAt: { type: Date, columnType: 'timestamptz', fieldName: 'updated_at' },
    retryable: { type: Boolean },
  },
});

export const REPORT_PERSISTENCE_ENTITIES = [
  ReportSchema,
] as const satisfies readonly EntitySchemaType[];
