import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  buildReportContent,
  ReportContentValidationError,
  REPORT_CONTENT_PROVIDER,
  validateReportDraft,
  type ReportContentDraft,
  type ReportContentProvider,
  type ReportProviderOutput,
  type ReportProviderResult,
  type ReportProviderUsage,
  type ReportSemanticValidation,
} from '@newtine/core/report/report.content.js';
import {
  AI_USAGE_REPOSITORY,
  REPORT_REPOSITORY,
  type AiUsageRepository,
  type ReportCandidates,
  type ReportClaim,
  type ReportRepository,
  type ReportUsageFinish,
  type ReportUsageStart,
} from '@newtine/core/report/report.model.js';
import { ReportException } from '@newtine/core/report/report.exception.js';
import type { UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import {
  REPORT_PROMPT_VERSION,
  ReportAiConfiguration,
  type ReportWorkerOptions,
} from './report.ai.config.js';
import { ReportProviderException } from './report.provider.js';

class ReportWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly resultUncertain: boolean;

  constructor(
    code: string,
    options: { retryable?: boolean; resultUncertain?: boolean; cause?: unknown } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ReportWorkerError';
    this.code = code;
    this.retryable = options.retryable ?? true;
    this.resultUncertain = options.resultUncertain ?? false;
  }
}

class StaleReportClaimError extends ReportWorkerError {
  constructor() {
    super('STALE_CLAIM', { retryable: false });
  }
}

@Injectable()
export class ReportWorker implements OnModuleDestroy {
  private stopped = false;
  private active = false;
  private readonly stopController = new AbortController();
  private readonly options: ReportWorkerOptions;
  private readonly configuration: ReportAiConfiguration;

  constructor(
    @Inject(REPORT_REPOSITORY) private readonly repository: ReportRepository,
    @Inject(REPORT_CONTENT_PROVIDER) private readonly provider: ReportContentProvider,
    @Inject(AI_USAGE_REPOSITORY) private readonly usageRepository: AiUsageRepository,
    private readonly logger: PinoLogger,
    configuration: ReportAiConfiguration,
  ) {
    this.logger.setContext(ReportWorker.name);
    this.configuration = configuration;
    this.options = configuration.worker;
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.stopController.abort();
  }

  async runOnce(processExecutionId?: UuidV7, signal?: AbortSignal): Promise<boolean> {
    if (this.stopped || signal?.aborted || this.active) return false;
    this.active = true;
    try {
      const claim = await this.repository.claim(new Date(), this.options.leaseMs);
      if (claim === null) return false;
      this.logger.info(
        {
          event: 'report.run.claimed',
          reportId: claim.id,
          attempt: claim.attempt,
          ...(processExecutionId === undefined ? {} : { processExecutionId }),
        },
        'Report run claimed',
      );
      await this.runWithDeadline(claim, signal);
      return true;
    } finally {
      this.active = false;
    }
  }

  async runForever(
    pollIntervalMs = this.options.pollIntervalMs,
    signal?: AbortSignal,
    processExecutionId?: UuidV7,
  ): Promise<void> {
    const combined = combineSignals(signal, this.stopController.signal);
    try {
      while (!this.stopped && !combined.signal.aborted) {
        const processed = await this.runOnce(processExecutionId, combined.signal);
        if (!processed) await wait(pollIntervalMs, combined.signal);
      }
    } finally {
      combined.dispose();
    }
  }

  async run(processExecutionId?: UuidV7, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.stopped) return;
    if (process.env.REPORT_WORKER_ONCE === '1') {
      await this.runOnce(processExecutionId, signal);
      return;
    }
    await this.runForever(this.options.pollIntervalMs, signal, processExecutionId);
  }

  private async runWithDeadline(claim: ReportClaim, signal?: AbortSignal): Promise<void> {
    const deadline = new AbortController();
    const combined = combineSignals(signal, deadline.signal);
    try {
      await withTimeout(
        this.processClaim(claim, combined.signal),
        this.options.executionTimeoutMs,
        combined.signal,
      );
    } catch (error: unknown) {
      deadline.abort();
      if (error instanceof StaleReportClaimError) return;
      const failure = toFailure(error);
      await this.safeFail(claim, failure.code, failure.retryable);
    } finally {
      combined.dispose();
    }
  }

  private async processClaim(claim: ReportClaim, signal?: AbortSignal): Promise<void> {
    let candidates: ReportCandidates;
    try {
      candidates = claim.candidates ?? (await this.repository.captureCandidates(claim, new Date()));
      candidates = await this.filterVisibleCandidates(claim, candidates);
      if (signal?.aborted || this.stopped) throw new ReportWorkerError('INTERRUPTED');

      const shouldCallProvider = claim.input.issues.length >= 5 || candidates.related.length > 0;
      const draft = shouldCallProvider
        ? await this.generateAndValidate(claim, candidates, signal)
        : emptyDraft();
      if (signal?.aborted || this.stopped) throw new ReportWorkerError('INTERRUPTED');

      // The repository's conditional update is the final ownership check.  A
      // second visibility read gives a safe error for withdrawn source issues
      // before attempting that update and keeps hidden source text out of a
      // completed result.
      await this.filterVisibleCandidates(claim, candidates);
      const content = buildReportContent(claim.input, candidates, draft, new Date());
      const saved = await this.repository.complete(claim, content, new Date());
      if (!saved) {
        this.logger.info(
          { event: 'report.run.stale_result', reportId: claim.id, attempt: claim.attempt },
          'Report result was discarded after lease ownership changed',
        );
      }
    } catch (error: unknown) {
      if (error instanceof StaleReportClaimError) return;
      throw error;
    }
  }

  private async generateAndValidate(
    claim: ReportClaim,
    candidates: ReportCandidates,
    signal?: AbortSignal,
  ): Promise<ReportContentDraft> {
    const allowConnections = claim.input.issues.length >= 5;
    const generated = await this.providerCall(
      claim,
      'report_generation',
      () => this.provider.generate({ input: claim.input, candidates, allowConnections }),
      this.configuration.generationPrompt.hash,
      signal,
    );
    const draft = validateReportDraft(generated.value, claim.input, candidates, allowConnections);
    const validation = await this.providerCall(
      claim,
      'report_semantic_validation',
      () => this.provider.validate({ input: claim.input, candidates, allowConnections, draft }),
      this.configuration.validationPrompt.hash,
      signal,
    );
    if (!isSemanticPass(validation.value)) {
      throw new ReportWorkerError('INVALID_OUTPUT');
    }
    return draft;
  }

  private async providerCall<T>(
    claim: ReportClaim,
    purpose: string,
    call: () => Promise<ReportProviderOutput<T>>,
    promptHash: string | undefined,
    signal?: AbortSignal,
  ): Promise<ReportProviderResult<T>> {
    if (signal?.aborted || this.stopped) throw new ReportWorkerError('INTERRUPTED');
    const usageStart: ReportUsageStart = {
      reportId: claim.id,
      attempt: claim.attempt,
      purpose,
      model: this.configuration.model,
      promptVersion: REPORT_PROMPT_VERSION,
      promptHash: promptHash ?? this.configuration.generationPrompt.hash,
      startedAt: new Date(),
    };
    let usageId: UuidV7;
    try {
      usageId = await this.usageRepository.beginReport(usageStart);
    } catch (error: unknown) {
      throw new ReportWorkerError('USAGE_START_FAILED', { cause: error });
    }

    let leaseLost = false;
    const beat = async (): Promise<void> => {
      if (leaseLost || signal?.aborted || this.stopped) return;
      try {
        const alive = await this.repository.heartbeat(claim, new Date(), this.options.leaseMs);
        if (!alive) leaseLost = true;
      } catch {
        leaseLost = true;
      }
    };
    const heartbeatTimer = setInterval(() => {
      void beat();
    }, this.options.heartbeatMs);

    let result: ReportProviderResult<T> | undefined;
    let usageFinished = false;
    let reconcileLate = false;
    const providerPromise = call();
    void providerPromise.then(
      async (late) => {
        if (!reconcileLate) return;
        try {
          const known = normalizeProviderResult(late);
          await this.finishUsage(usageId, known.usage, 'SUCCEEDED');
        } catch {
          /* Leave uncertain usage UNKNOWN if the late payload is invalid. */
        }
      },
      () => undefined,
    );
    try {
      result = normalizeProviderResult(
        await withTimeout(providerPromise, this.options.providerTimeoutMs, signal),
      );
      await this.finishUsage(usageId, result.usage, 'SUCCEEDED');
      usageFinished = true;
      if (leaseLost) throw new StaleReportClaimError();
      return result;
    } catch (error: unknown) {
      if (!usageFinished) {
        reconcileLate = errorResultStatus(error) === 'UNKNOWN';
        await this.finishUsage(
          usageId,
          result?.usage ?? providerUsage(error),
          errorResultStatus(error),
          failureCode(error),
        );
      }
      if (leaseLost) throw new StaleReportClaimError();
      throw error;
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private async finishUsage(
    usageId: UuidV7,
    usage: ReportProviderResult<unknown>['usage'],
    status: ReportUsageFinish['status'],
    errorCode?: string,
  ): Promise<void> {
    try {
      await this.usageRepository.finish(usageId, {
        status,
        ...(usage?.model === undefined ? {} : { model: usage.model }),
        ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        ...(errorCode === undefined ? {} : { errorCode }),
        finishedAt: new Date(),
      });
    } catch {
      this.logger.warn(
        { event: 'report.usage.finish_failed', usageId },
        'Report usage finish failed',
      );
    }
  }

  private async filterVisibleCandidates(
    claim: ReportClaim,
    candidates: ReportCandidates,
  ): Promise<ReportCandidates> {
    const ids = unique([
      ...claim.input.issues.map((issue) => issue.issueId),
      ...candidates.related.map((issue) => issue.issueId),
      ...candidates.major.map((issue) => issue.issueId),
    ]);
    if (ids.length === 0) return candidates;
    const visibility = await this.repository.visibility(claim.userId, ids);
    const publicIds = new Set(visibility.publicIssueIds);
    if (claim.input.issues.some((issue) => !publicIds.has(issue.issueId))) {
      throw new ReportWorkerError('SOURCE_UNAVAILABLE', { retryable: false });
    }
    const actedIds = new Set(visibility.actedIssueIds);
    const available = (issue: { issueId: UuidV7 }): boolean =>
      publicIds.has(issue.issueId) && !actedIds.has(issue.issueId);
    const related = candidates.related.filter(available);
    const major = candidates.major.filter(available);
    return {
      ...candidates,
      related,
      major,
      relatedUnavailable:
        candidates.relatedUnavailable ||
        related.length !== candidates.related.length ||
        major.length !== candidates.major.length,
    };
  }

  private async safeFail(claim: ReportClaim, code: string, retryable: boolean): Promise<void> {
    try {
      const saved = await this.repository.fail(claim, code, retryable, new Date());
      if (!saved) {
        this.logger.info(
          { event: 'report.run.stale_failure', reportId: claim.id, attempt: claim.attempt },
          'Report failure was discarded after lease ownership changed',
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        { event: 'report.run.fail_persist_failed', reportId: claim.id, code },
        'Report failure persistence failed',
      );
      throw error;
    }
  }
}

function emptyDraft(): ReportContentDraft {
  return { connections: [], related: [] };
}

function normalizeProviderResult<T>(output: ReportProviderOutput<T>): ReportProviderResult<T> {
  let result: ReportProviderResult<T>;
  if (
    typeof output === 'object' &&
    output !== null &&
    !Array.isArray(output) &&
    'value' in output &&
    (Object.keys(output).length === 1 || 'usage' in output)
  ) {
    result = output as ReportProviderResult<T>;
  } else {
    result = { value: output as T };
  }
  if (result.usage !== undefined && !isValidProviderUsage(result.usage)) {
    throw new ReportWorkerError('INVALID_OUTPUT');
  }
  return result;
}

function isValidProviderUsage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  for (const key of ['inputTokens', 'outputTokens']) {
    const number = usage[key];
    if (
      number !== undefined &&
      (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)
    ) {
      return false;
    }
  }
  for (const key of ['model']) {
    const string = usage[key];
    if (string !== undefined && (typeof string !== 'string' || string.trim().length === 0)) {
      return false;
    }
  }
  return true;
}

function isSemanticPass(value: unknown): value is ReportSemanticValidation {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  return (
    record?.status === 'PASS' &&
    typeof record.reason === 'string' &&
    record.reason.trim().length > 0
  );
}

function toFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof ReportProviderException) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof ReportContentValidationError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof ReportWorkerError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof ReportException) {
    return { code: error.code, retryable: error.code !== 'SOURCE_UNAVAILABLE' };
  }
  return { code: 'UPSTREAM_ERROR', retryable: true };
}

function failureCode(error: unknown): string {
  return toFailure(error).code;
}

function providerUsage(error: unknown): ReportProviderUsage | undefined {
  return error instanceof ReportProviderException ? error.usage : undefined;
}

function errorResultStatus(error: unknown): ReportUsageFinish['status'] {
  if (error instanceof ReportProviderException && error.resultUncertain) return 'UNKNOWN';
  if (error instanceof ReportWorkerError && error.resultUncertain) return 'UNKNOWN';
  return 'FAILED';
}

function unique(values: readonly UuidV7[]): UuidV7[] {
  return [...new Set(values)];
}

function combineSignals(
  first: AbortSignal | undefined,
  second: AbortSignal,
): {
  signal: AbortSignal;
  dispose: () => void;
} {
  if (first === undefined) return { signal: second, dispose: () => undefined };
  if (first.aborted) return { signal: first, dispose: () => undefined };
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  first.addEventListener('abort', abort, { once: true });
  second.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener('abort', abort);
      second.removeEventListener('abort', abort);
    },
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ReportWorkerError('TIMEOUT', { retryable: true, resultUncertain: true })),
      timeoutMs,
    );
    if (signal !== undefined) {
      abort = (): void =>
        reject(new ReportWorkerError('INTERRUPTED', { retryable: true, resultUncertain: true }));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal !== undefined && abort !== undefined) signal.removeEventListener('abort', abort);
  }
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const onAbort = (): void => finish();
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
