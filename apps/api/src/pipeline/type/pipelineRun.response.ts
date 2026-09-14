import { tags } from 'typia';

export type PipelineRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'PARTIALLY_SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';
export type PipelineJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type PipelineJobStage = 'SEARCH' | 'FETCH' | 'GENERATE' | 'VALIDATE';

export interface PipelineRunAcceptedResponse {
  runId: string & tags.Format<'uuid'>;
  status: PipelineRunStatus;
}

export interface PipelineJobResponse {
  id: string & tags.Format<'uuid'>;
  issueId: string & tags.Format<'uuid'>;
  status: PipelineJobStatus;
  stage: PipelineJobStage;
  attempt: number;
  failureKind?: string;
  lastError?: string;
}

export interface PipelineUsageSummaryResponse {
  calls: number;
  succeededCalls: number;
  failedCalls: number;
  unknownCalls: number;
  inputTokens: number;
  outputTokens: number;
  actualCost: number | null;
}

export interface PipelineRunResponse {
  runId: string & tags.Format<'uuid'>;
  status: PipelineRunStatus;
  attempt: number;
  executionId?: string & tags.Format<'uuid'>;
  currentStage?: PipelineJobStage;
  candidateCounts: {
    discovered: number;
    duplicate: number;
    uncertain: number;
    created: number;
    skippedByLimit: number;
  };
  jobs: PipelineJobResponse[];
  embeddingPendingCount: number;
  usageSummary: PipelineUsageSummaryResponse;
  lastError?: string;
  startedAt?: string & tags.Format<'date-time'>;
  finishedAt?: string & tags.Format<'date-time'>;
  createdAt: string & tags.Format<'date-time'>;
  updatedAt: string & tags.Format<'date-time'>;
}
