import { Inject, Injectable, Optional } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  EMBEDDING_PROVIDER,
  PIPELINE_RUN_REPOSITORY,
  PipelineException,
  PipelineExceptionCode,
  generateUuidV7,
  pipelineExternalException,
  type EmbeddingProvider,
  type PipelineEmbeddingTask,
  type PipelineFailureKind,
  type PipelineRunRepository,
  type ProviderOutput,
  type ProviderUsageMetadata,
  type UuidV7,
  type UsageRecordInput,
} from '@newtine/core';
import { PipelineAiConfiguration } from '@newtine/batch/pipeline/pipeline.ai.config.js';

export const PIPELINE_EMBEDDING_REPAIR_BATCH_SIZE = 100;

@Injectable()
export class PipelineEmbeddingRepairJob {
  constructor(
    @Inject(PIPELINE_RUN_REPOSITORY) private readonly repository: PipelineRunRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    private readonly logger: PinoLogger,
    @Optional() private readonly aiConfiguration?: PipelineAiConfiguration,
  ) {
    this.logger.setContext(PipelineEmbeddingRepairJob.name);
  }

  async run(
    processExecutionId?: UuidV7,
    reclaimProcessExecutionId?: UuidV7,
    signal?: AbortSignal,
  ): Promise<void> {
    const owner = processExecutionId ?? generateUuidV7();
    if (signal?.aborted) return;
    if (reclaimProcessExecutionId !== undefined) {
      const reclaimed = await this.repository.requeueEmbeddingClaims(reclaimProcessExecutionId);
      this.logger.warn(
        {
          event: 'pipeline.embedding_repair.reclaimed',
          reclaimedTaskCount: reclaimed,
          reclaimedProcessExecutionId: reclaimProcessExecutionId,
          processExecutionId: owner,
        },
        'Embedding repair claims were explicitly requeued',
      );
    }
    const claimToken = generateUuidV7();
    const tasks = await this.repository.claimPendingEmbeddingTasks(
      PIPELINE_EMBEDDING_REPAIR_BATCH_SIZE,
      owner,
      claimToken,
    );
    this.logger.info(
      {
        event: 'pipeline.embedding_repair.started',
        taskCount: tasks.length,
        processExecutionId: owner,
      },
      'Embedding repair started',
    );
    for (const task of tasks) {
      if (signal?.aborted) {
        const releasedTaskCount = await this.repository.releaseEmbeddingClaims(owner);
        this.logger.warn(
          {
            event: 'pipeline.embedding_repair.stopped',
            releasedTaskCount,
            processExecutionId: owner,
          },
          'Embedding repair stopped before the next task',
        );
        return;
      }
      await this.repairTask(task, owner, claimToken, signal);
    }
    this.logger.info(
      {
        event: 'pipeline.embedding_repair.completed',
        taskCount: tasks.length,
        processExecutionId: owner,
      },
      'Embedding repair completed',
    );
  }

  private async repairTask(
    task: PipelineEmbeddingTask,
    processExecutionId: UuidV7,
    claimToken: UuidV7,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      await this.repository.releaseEmbeddingClaims(processExecutionId);
      return;
    }
    const issue = await this.repository.loadIssue(task.issueId);
    if (issue?.publicationStatus !== 'PUBLISHED') {
      const released = await this.repository.releaseEmbeddingClaim(task.id, claimToken);
      if (released) {
        this.logger.warn(
          {
            event: 'pipeline.embedding_repair.skipped_withdrawn',
            taskId: task.id,
            issueId: task.issueId,
            processExecutionId,
          },
          'Embedding repair skipped a non-published issue',
        );
      }
      return;
    }
    if (signal?.aborted) {
      await this.repository.releaseEmbeddingClaims(processExecutionId);
      return;
    }
    const startedAt = new Date().toISOString();
    let result:
      | { value: { model: string; vector: number[] }; usage?: ProviderUsageMetadata }
      | undefined;
    try {
      result = unwrapProviderOutput(
        await this.embeddingProvider.embed(`${task.title}\n${task.integratedSummary}`, task.model),
      );
      const dimension = this.aiConfiguration?.stage('embedding').dimension ?? 1_536;
      const vector = result.value?.vector;
      const model = result.value?.model;
      if (
        !Array.isArray(vector) ||
        vector.length !== dimension ||
        vector.some((value) => !Number.isFinite(value)) ||
        typeof model !== 'string' ||
        model !== task.model
      ) {
        throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
      }
    } catch (error: unknown) {
      const failureKind = toFailureKind(error);
      await this.recordFailureUsage(
        task,
        startedAt,
        failureKind,
        processExecutionId,
        error,
        result,
      );
      await this.repository.failEmbeddingTask(task.id, claimToken, safeFailureMessage(failureKind));
      this.logPending(task, processExecutionId, failureKind);
      return;
    }

    if (result === undefined) return;

    await this.tryRecordUsage(
      {
        runId: task.runId,
        runAttempt: task.runAttempt,
        jobId: task.jobId,
        operation: 'EMBED',
        purpose: 'issue embedding repair',
        provider: 'openai',
        model: result.usage?.model ?? result.value.model ?? task.model,
        status: 'SUCCEEDED',
        ...(result.usage?.requestId === undefined ? {} : { requestId: result.usage.requestId }),
        ...(result.usage?.inputTokens === undefined
          ? {}
          : { inputTokens: result.usage.inputTokens }),
        ...(result.usage?.outputTokens === undefined
          ? {}
          : { outputTokens: result.usage.outputTokens }),
        startedAt,
        finishedAt: new Date().toISOString(),
      },
      { runExecutionId: task.runExecutionId, processExecutionId },
    );

    try {
      const saved = await this.repository.saveEmbedding(
        task.issueId,
        task.title,
        task.integratedSummary,
        result.value.vector,
        result.value.model,
        task.id,
        claimToken,
        task.model,
      );
      if (saved === 'STALE') {
        this.logger.warn(
          {
            event: 'pipeline.embedding_repair.stale',
            taskId: task.id,
            runId: task.runId,
            runExecutionId: task.runExecutionId,
            issueId: task.issueId,
            processExecutionId,
          },
          'Embedding repair result was stale and was not persisted',
        );
        return;
      }
      this.logger.info(
        {
          event: 'pipeline.embedding_repair.succeeded',
          taskId: task.id,
          runId: task.runId,
          runExecutionId: task.runExecutionId,
          issueId: task.issueId,
          processExecutionId,
        },
        'Embedding repair succeeded',
      );
    } catch (error: unknown) {
      const failureKind = toFailureKind(error);
      await this.repository.failEmbeddingTask(task.id, claimToken, safeFailureMessage(failureKind));
      this.logPending(task, processExecutionId, failureKind);
    }
  }

  private async recordFailureUsage(
    task: PipelineEmbeddingTask,
    startedAt: string,
    failureKind: PipelineFailureKind,
    processExecutionId: UuidV7,
    error?: unknown,
    result?: { value: { model: string; vector: number[] }; usage?: ProviderUsageMetadata },
  ): Promise<void> {
    await this.tryRecordUsage(
      {
        runId: task.runId,
        runAttempt: task.runAttempt,
        jobId: task.jobId,
        operation: 'EMBED',
        purpose: 'issue embedding repair',
        provider: 'openai',
        model: result?.usage?.model ?? result?.value?.model ?? task.model,
        status: usageStatusForFailure(error),
        errorCode: failureKind,
        ...(result?.usage?.requestId === undefined ? {} : { requestId: result.usage.requestId }),
        ...(result?.usage?.inputTokens === undefined
          ? {}
          : { inputTokens: result.usage.inputTokens }),
        ...(result?.usage?.outputTokens === undefined
          ? {}
          : { outputTokens: result.usage.outputTokens }),
        startedAt,
        finishedAt: new Date().toISOString(),
      },
      { runExecutionId: task.runExecutionId, processExecutionId },
    );
  }

  private logPending(
    task: PipelineEmbeddingTask,
    processExecutionId: UuidV7,
    failureKind: PipelineFailureKind,
  ): void {
    this.logger.warn(
      {
        event: 'pipeline.embedding_repair.pending',
        taskId: task.id,
        runId: task.runId,
        runExecutionId: task.runExecutionId,
        issueId: task.issueId,
        processExecutionId,
        failureKind,
      },
      'Embedding repair remains pending',
    );
  }

  private async tryRecordUsage(
    input: UsageRecordInput,
    context: { runExecutionId?: UuidV7; processExecutionId: UuidV7 },
  ): Promise<void> {
    try {
      await this.repository.recordUsage(input);
    } catch {
      this.logger.warn(
        {
          event: 'pipeline.usage.record_failed',
          runId: input.runId,
          ...(context.runExecutionId === undefined
            ? {}
            : { runExecutionId: context.runExecutionId }),
          processExecutionId: context.processExecutionId,
        },
        'Pipeline usage record failed',
      );
    }
  }
}

function unwrapProviderOutput<T>(output: ProviderOutput<T>): {
  value: T;
  usage?: ProviderUsageMetadata;
} {
  if (isProviderResult(output)) return output;
  return { value: output };
}

function isProviderResult<T>(output: ProviderOutput<T>): output is {
  value: T;
  usage?: ProviderUsageMetadata;
} {
  return (
    typeof output === 'object' &&
    output !== null &&
    !Array.isArray(output) &&
    'value' in output &&
    (Object.keys(output).length === 1 || 'usage' in output)
  );
}

function usageStatusForFailure(error: unknown): 'FAILED' | 'UNKNOWN' {
  return error instanceof PipelineException && error.resultUncertain ? 'UNKNOWN' : 'FAILED';
}

function toFailureKind(error: unknown): PipelineFailureKind {
  if (error instanceof PipelineException) {
    switch (error.code) {
      case PipelineExceptionCode.InvalidOutput:
      case PipelineExceptionCode.InvalidInput:
        return 'INVALID_OUTPUT';
      case PipelineExceptionCode.SourceUnavailable:
        return 'SOURCE_UNAVAILABLE';
      case PipelineExceptionCode.InsufficientEvidence:
        return 'INSUFFICIENT_EVIDENCE';
      default:
        return 'UPSTREAM_ERROR';
    }
  }
  return 'UPSTREAM_ERROR';
}

function safeFailureMessage(kind: PipelineFailureKind): string {
  switch (kind) {
    case 'INVALID_OUTPUT':
      return '임베딩 결과가 서비스 검증을 통과하지 못했습니다.';
    default:
      return '임베딩 보완 처리 중 오류가 발생했습니다.';
  }
}
