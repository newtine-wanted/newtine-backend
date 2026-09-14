import type { PipelineRunSnapshot } from '@newtine/core';
import type { PipelineRunResponse, PipelineRunAcceptedResponse } from './pipelineRun.response.js';

export function toPipelineRunAcceptedResponse(
  snapshot: PipelineRunSnapshot,
): PipelineRunAcceptedResponse {
  return { runId: snapshot.id as PipelineRunAcceptedResponse['runId'], status: snapshot.status };
}

export function toPipelineRunResponse(snapshot: PipelineRunSnapshot): PipelineRunResponse {
  return {
    runId: snapshot.id as PipelineRunResponse['runId'],
    status: snapshot.status,
    attempt: snapshot.attempt,
    executionId: snapshot.executionId as PipelineRunResponse['executionId'],
    currentStage: snapshot.currentStage,
    candidateCounts: snapshot.candidateCounts,
    jobs: snapshot.jobs.map((job) => ({
      id: job.id as PipelineRunResponse['jobs'][number]['id'],
      issueId: job.issueId as PipelineRunResponse['jobs'][number]['issueId'],
      status: job.status,
      stage: job.stage,
      attempt: job.attempt,
      ...(job.failureKind === undefined ? {} : { failureKind: job.failureKind }),
      ...(job.lastError === undefined ? {} : { lastError: job.lastError }),
    })),
    embeddingPendingCount: snapshot.embeddingPendingCount,
    usageSummary: snapshot.usageSummary,
    ...(snapshot.lastError === undefined ? {} : { lastError: snapshot.lastError }),
    ...(snapshot.startedAt === undefined
      ? {}
      : { startedAt: snapshot.startedAt as PipelineRunResponse['startedAt'] }),
    ...(snapshot.finishedAt === undefined
      ? {}
      : { finishedAt: snapshot.finishedAt as PipelineRunResponse['finishedAt'] }),
    createdAt: snapshot.createdAt as PipelineRunResponse['createdAt'],
    updatedAt: snapshot.updatedAt as PipelineRunResponse['updatedAt'],
  };
}
