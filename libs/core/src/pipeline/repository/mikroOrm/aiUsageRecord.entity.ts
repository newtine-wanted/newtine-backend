import { EntitySchema } from '@mikro-orm/core';

import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

export interface AiUsageRecordEntity {
  id: UuidV7;
  pipelineRunId: UuidV7 | null;
  issueContentJobId: UuidV7 | null;
  runAttempt: number;
  operation: string;
  purpose: string;
  promptVersion: string | null;
  promptHash: string | null;
  provider: string;
  status: string;
  model: string | null;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  actualCost: number | null;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
}

/**
 * The usage ledger is intentionally mapped even while the pipeline lifecycle
 * repository still uses SQL for its PostgreSQL-specific state transitions.
 */
export const AiUsageRecordEntity = new EntitySchema<AiUsageRecordEntity>({
  name: 'AiUsageRecord',
  tableName: 'ai_usage_records',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    pipelineRunId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'pipeline_run_id',
      nullable: true,
    },
    issueContentJobId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'issue_content_job_id',
      nullable: true,
    },
    runAttempt: { type: Number },
    operation: { type: String },
    purpose: { type: String },
    promptVersion: { type: String, fieldName: 'prompt_version', nullable: true },
    promptHash: { type: String, fieldName: 'prompt_hash', nullable: true },
    provider: { type: String },
    status: { type: String },
    model: { type: String, nullable: true },
    providerRequestId: { type: String, fieldName: 'provider_request_id', nullable: true },
    inputTokens: { type: Number, fieldName: 'input_tokens', nullable: true },
    outputTokens: { type: Number, fieldName: 'output_tokens', nullable: true },
    actualCost: { type: Number, columnType: 'numeric', fieldName: 'actual_cost', nullable: true },
    errorCode: { type: String, fieldName: 'error_code', nullable: true },
    startedAt: { type: Date, columnType: 'timestamptz', fieldName: 'started_at' },
    finishedAt: {
      type: Date,
      columnType: 'timestamptz',
      fieldName: 'finished_at',
      nullable: true,
    },
    createdAt: { type: Date, columnType: 'timestamptz', fieldName: 'created_at' },
  },
});
