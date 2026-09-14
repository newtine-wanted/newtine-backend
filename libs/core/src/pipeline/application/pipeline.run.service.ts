import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { isUuidV7, type UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import { normalizePipelineLimits } from '@newtine/core/pipeline/domain/pipeline.limits.js';
import {
  PipelineException,
  PipelineExceptionCode,
} from '@newtine/core/pipeline/domain/pipeline.exception.js';
import type {
  PipelineRunRequest,
  PipelineRunSnapshot,
} from '@newtine/core/pipeline/domain/pipeline.types.js';
import {
  PIPELINE_RUN_REPOSITORY,
  type PipelineRunRepository,
} from '@newtine/core/pipeline/repository/pipeline.repository.js';

export interface EnqueueRunCommand {
  idempotencyKey: string;
  query: string;
}

interface RetryRunCommandBase {
  runId: string;
  expectedAttempt: number;
}

export type RetryRunCommand =
  | (RetryRunCommandBase & { scope: 'DISCOVERY'; failedJobIds?: string[] })
  | (RetryRunCommandBase & { scope: 'CONTENT'; failedJobIds: string[] });

export interface InterruptRunCommand {
  runId: string;
  expectedAttempt: number;
  executionId: string;
}

@Injectable()
export class PipelineRunService {
  constructor(
    @Inject(PIPELINE_RUN_REPOSITORY)
    private readonly repository: PipelineRunRepository,
  ) {}

  async enqueue(command: EnqueueRunCommand): Promise<PipelineRunSnapshot> {
    const idempotencyKey = normalizeRequired(command.idempotencyKey, 'Idempotency-Key');
    const query = normalizeRequired(command.query, 'query');
    const request: PipelineRunRequest = { query, limits: normalizePipelineLimits() };
    const requestHash = sha256(JSON.stringify(request));
    return this.repository.enqueue({ idempotencyKey, requestHash, request });
  }

  async get(runId: string): Promise<PipelineRunSnapshot> {
    const id = this.requireId(runId);
    const snapshot = await this.repository.findById(id);
    if (snapshot === null) {
      throw new PipelineException(PipelineExceptionCode.RunNotFound, '실행을 찾을 수 없습니다.');
    }
    return snapshot;
  }

  async retry(command: RetryRunCommand): Promise<PipelineRunSnapshot> {
    const runId = this.requireId(command.runId);
    if (command.scope !== 'DISCOVERY' && command.scope !== 'CONTENT') {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        '재시도 범위가 올바르지 않습니다.',
      );
    }
    if (!Number.isSafeInteger(command.expectedAttempt) || command.expectedAttempt < 1) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        'expectedAttempt가 올바르지 않습니다.',
      );
    }
    if (
      command.scope === 'CONTENT' &&
      (!Array.isArray(command.failedJobIds) || command.failedJobIds.length === 0)
    ) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        'CONTENT 재시도에는 하나 이상의 failedJobIds가 필요합니다.',
      );
    }
    if (
      command.failedJobIds !== undefined &&
      (!Array.isArray(command.failedJobIds) || command.failedJobIds.length === 0)
    ) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        'failedJobIds가 지정되면 하나 이상의 job이 필요합니다.',
      );
    }
    if (command.scope === 'CONTENT') {
      const failedJobIds = command.failedJobIds.map((id) => this.requireId(id));
      return this.repository.retry({
        runId,
        expectedAttempt: command.expectedAttempt,
        scope: 'CONTENT',
        failedJobIds,
      });
    }
    const failedJobIds = command.failedJobIds?.map((id) => this.requireId(id));
    return this.repository.retry({
      runId,
      expectedAttempt: command.expectedAttempt,
      scope: 'DISCOVERY',
      failedJobIds,
    });
  }

  async interrupt(command: InterruptRunCommand): Promise<PipelineRunSnapshot> {
    const runId = this.requireId(command.runId);
    const executionId = this.requireId(command.executionId);
    if (!Number.isSafeInteger(command.expectedAttempt) || command.expectedAttempt < 1) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        'expectedAttempt가 올바르지 않습니다.',
      );
    }
    return this.repository.interrupt({
      runId,
      expectedAttempt: command.expectedAttempt,
      executionId,
    });
  }

  private requireId(value: string): UuidV7 {
    if (!isUuidV7(value)) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        'UUIDv7 식별자가 필요합니다.',
      );
    }
    return value;
  }
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new PipelineException(
      PipelineExceptionCode.InvalidInput,
      `${field}가 올바르지 않습니다.`,
    );
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
