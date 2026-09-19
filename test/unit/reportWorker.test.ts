import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import type {
  AiUsageRepository,
  ReportCandidates,
  ReportClaim,
  ReportContent,
  ReportInput,
  ReportRepository,
  ReportUsageFinish,
  ReportUsageStart,
} from '@newtine/core/report/report.model.js';
import type { ReportContentProvider } from '@newtine/core/report/report.content.js';
import { ReportAiConfiguration } from '@newtine/batch/report/report.ai.config.js';
import { ReportProviderException } from '@newtine/batch/report/report.provider.js';
import { ReportWorker } from '@newtine/batch/report/report.worker.js';

function logger(): never {
  return {
    setContext: (): void => undefined,
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
  } as never;
}

function configuration(overrides: NodeJS.ProcessEnv = {}): ReportAiConfiguration {
  return new ReportAiConfiguration({
    REPORT_AI_MODEL: 'report-test-model',
    OPENAI_API_KEY: 'report-test-key',
    ...overrides,
  });
}

function issue() {
  const issueId = generateUuidV7();
  return {
    issueId,
    title: '관심 이슈',
    categoryCode: 'ECONOMY',
    categoryName: '경제',
    categoryOrder: 1,
    summary: '요약',
    summaryLines: ['요약'],
  };
}

function claim(issueCount: number): { claim: ReportClaim; issues: ReturnType<typeof issue>[] } {
  const issues = Array.from({ length: issueCount }, issue);
  const reportId = generateUuidV7();
  const userId = generateUuidV7();
  const now = new Date().toISOString();
  const input: ReportInput = {
    version: 1,
    capturedAt: now,
    issues,
    categoryCounts:
      issueCount === 0 ? [] : [{ categoryCode: 'ECONOMY', displayName: '경제', count: issueCount }],
    excludedCount: 0,
    hash: 'input-hash',
  };
  return {
    issues,
    claim: {
      id: reportId,
      userId,
      period: {
        start: '2026-09-07',
        end: '2026-09-14',
        startAt: '2026-09-06T15:00:00.000Z',
        endAt: '2026-09-13T15:00:00.000Z',
      },
      status: 'RUNNING',
      input,
      candidates: null,
      content: null,
      attempt: 1,
      leaseToken: generateUuidV7(),
      leaseExpiresAt: new Date(Date.now() + 180_000).toISOString(),
      requestedAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      nextAttemptAt: now,
      lastErrorCode: null,
      retryable: false,
    },
  };
}

function candidates(): ReportCandidates {
  return {
    capturedAt: new Date().toISOString(),
    related: [],
    major: [],
    majorCategoryCodes: [],
    relatedUnavailable: false,
  };
}

function repositoryFor(
  current: ReportClaim,
  candidateSnapshot: ReportCandidates,
  options: {
    heartbeat?: (claim: ReportClaim) => Promise<boolean>;
    visibility?: (ids: string[]) => Promise<string[]>;
  } = {},
): {
  repository: ReportRepository;
  completed: ReportContent[];
  failures: Array<{ code: string; retryable: boolean }>;
} {
  const completed: ReportContent[] = [];
  const failures: Array<{ code: string; retryable: boolean }> = [];
  const repository: ReportRepository = {
    request: async () => current,
    findOwned: async () => current,
    listOwned: async () => [current],
    findLatestSucceeded: async () => null,
    retry: async () => current,
    claim: async () => current,
    heartbeat: async (value) => options.heartbeat?.(value) ?? true,
    captureCandidates: async () => candidateSnapshot,
    visibility: async (_userId, ids) => ({
      publicIssueIds: options.visibility
        ? ((await options.visibility(ids)) as typeof ids)
        : [...ids],
      actedIssueIds: [],
    }),
    complete: async (_claim, content) => {
      completed.push(content);
      return true;
    },
    fail: async (_claim, code, retryable) => {
      failures.push({ code, retryable });
      return true;
    },
  };
  return { repository, completed, failures };
}

function usageRepository(): {
  repository: AiUsageRepository;
  starts: ReportUsageStart[];
  finishes: ReportUsageFinish[];
} {
  const starts: ReportUsageStart[] = [];
  const finishes: ReportUsageFinish[] = [];
  return {
    starts,
    finishes,
    repository: {
      beginReport: async (input) => {
        starts.push(input);
        return generateUuidV7();
      },
      finish: async (_id, result) => {
        finishes.push(result);
      },
    },
  };
}

test('worker skips AI for a low-sample snapshot without candidates and stores an 안내 result', async () => {
  const { claim: reportClaim } = claim(4);
  const state = repositoryFor(reportClaim, candidates());
  const usage = usageRepository();
  let generated = false;
  const provider: ReportContentProvider = {
    generate: async () => {
      generated = true;
      return { connections: [], related: [] };
    },
    validate: async () => ({ status: 'PASS', reason: 'ok' }),
  };
  const worker = new ReportWorker(
    state.repository,
    provider,
    usage.repository,
    logger(),
    configuration(),
  );

  assert.equal(await worker.runOnce(), true);
  assert.equal(generated, false);
  assert.equal(usage.starts.length, 0);
  assert.equal(state.failures.length, 0);
  assert.equal(state.completed[0]?.analysisStatus, 'INSUFFICIENT_DATA');
});

test('worker runs semantic validation after generation and persists the validated report', async () => {
  const { claim: reportClaim, issues } = claim(5);
  const state = repositoryFor(reportClaim, candidates());
  const usage = usageRepository();
  let validations = 0;
  const provider: ReportContentProvider = {
    generate: async () => ({
      connections: [
        {
          label: '공통 정책',
          title: '두 이슈의 연결',
          description: '두 이슈는 같은 정책 변화와 관련됩니다. 세부 영향은 서로 다릅니다.',
          issueIds: [issues[0]!.issueId, issues[1]!.issueId],
        },
      ],
      related: [],
    }),
    validate: async () => {
      validations += 1;
      return { status: 'PASS', reason: '스냅샷과 초안의 근거가 일치합니다.' };
    },
  };
  const worker = new ReportWorker(
    state.repository,
    provider,
    usage.repository,
    logger(),
    configuration(),
  );

  assert.equal(await worker.runOnce(), true);
  assert.equal(validations, 1);
  assert.equal(usage.starts.length, 2);
  assert.equal(usage.finishes.length, 2);
  assert.equal(
    usage.finishes.every((finish) => finish.status === 'SUCCEEDED'),
    true,
  );
  assert.equal(state.completed[0]?.analysisStatus, 'READY');
});

test('worker rejects hallucinated connection IDs and never persists invalid content', async () => {
  const { claim: reportClaim } = claim(5);
  const state = repositoryFor(reportClaim, candidates());
  const usage = usageRepository();
  const provider: ReportContentProvider = {
    generate: async () => ({
      connections: [
        {
          label: '연결',
          title: '제목',
          description: '첫 문장입니다. 둘째 문장입니다.',
          issueIds: [generateUuidV7(), generateUuidV7()],
        },
      ],
      related: [],
    }),
    validate: async () => ({ status: 'PASS', reason: 'ok' }),
  };
  const worker = new ReportWorker(
    state.repository,
    provider,
    usage.repository,
    logger(),
    configuration(),
  );

  assert.equal(await worker.runOnce(), true);
  assert.equal(state.completed.length, 0);
  assert.equal(state.failures[0]?.code, 'HALLUCINATED_ID');
  assert.equal(usage.finishes[0]?.status, 'SUCCEEDED');
});

test('worker records UNKNOWN usage when a provider result is uncertain', async () => {
  const { claim: reportClaim } = claim(5);
  const state = repositoryFor(reportClaim, candidates());
  const usage = usageRepository();
  const provider: ReportContentProvider = {
    generate: async () => {
      throw new ReportProviderException('TIMEOUT', { retryable: true, resultUncertain: true });
    },
    validate: async () => ({ status: 'PASS', reason: 'ok' }),
  };
  const worker = new ReportWorker(
    state.repository,
    provider,
    usage.repository,
    logger(),
    configuration(),
  );

  assert.equal(await worker.runOnce(), true);
  assert.equal(state.failures[0]?.code, 'TIMEOUT');
  assert.equal(state.failures[0]?.retryable, true);
  assert.equal(usage.finishes[0]?.status, 'UNKNOWN');
});

test('worker retries malformed provider output', async () => {
  const { claim: reportClaim } = claim(5);
  const state = repositoryFor(reportClaim, candidates());
  const usage = usageRepository();
  const provider: ReportContentProvider = {
    generate: async () => {
      throw new ReportProviderException('INVALID_OUTPUT');
    },
    validate: async () => ({ status: 'PASS', reason: 'ok' }),
  };
  const worker = new ReportWorker(
    state.repository,
    provider,
    usage.repository,
    logger(),
    configuration(),
  );

  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(state.failures[0], { code: 'INVALID_OUTPUT', retryable: true });
  assert.equal(usage.finishes[0]?.status, 'FAILED');
  assert.equal(usage.finishes[0]?.errorCode, 'INVALID_OUTPUT');
});

test('worker treats a provider input limit as a permanent failure', async () => {
  const { claim: reportClaim } = claim(5);
  const state = repositoryFor(reportClaim, candidates());
  const usage = usageRepository();
  const provider: ReportContentProvider = {
    generate: async () => {
      throw new ReportProviderException('INPUT_LIMIT_EXCEEDED');
    },
    validate: async () => ({ status: 'PASS', reason: 'ok' }),
  };
  const worker = new ReportWorker(
    state.repository,
    provider,
    usage.repository,
    logger(),
    configuration(),
  );

  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(state.failures[0], { code: 'INPUT_LIMIT_EXCEEDED', retryable: false });
  assert.equal(usage.finishes[0]?.status, 'FAILED');
  assert.equal(usage.finishes[0]?.errorCode, 'INPUT_LIMIT_EXCEEDED');
});

test('worker carries provider model metadata into a failed usage record', async () => {
  const { claim: reportClaim } = claim(5);
  const state = repositoryFor(reportClaim, candidates());
  const usage = usageRepository();
  const provider: ReportContentProvider = {
    generate: async () => {
      throw new ReportProviderException('UPSTREAM_ERROR', {
        retryable: false,
        usage: { model: 'actual-report-model' },
      });
    },
    validate: async () => ({ status: 'PASS', reason: 'ok' }),
  };
  const worker = new ReportWorker(
    state.repository,
    provider,
    usage.repository,
    logger(),
    configuration(),
  );

  assert.equal(await worker.runOnce(), true);
  assert.equal(state.failures[0]?.code, 'UPSTREAM_ERROR');
  assert.equal(usage.finishes[0]?.status, 'FAILED');
  assert.equal(usage.finishes[0]?.model, 'actual-report-model');
});

test('worker discards a result when heartbeat loses the lease', async () => {
  const { claim: reportClaim } = claim(5);
  let beats = 0;
  const state = repositoryFor(reportClaim, candidates(), {
    heartbeat: async () => {
      beats += 1;
      return false;
    },
  });
  const usage = usageRepository();
  const provider: ReportContentProvider = {
    generate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      return { connections: [], related: [] };
    },
    validate: async () => ({ status: 'PASS', reason: 'ok' }),
  };
  const worker = new ReportWorker(
    state.repository,
    provider,
    usage.repository,
    logger(),
    configuration({
      REPORT_AI_TIMEOUT_MS: '2000',
      REPORT_WORKER_HEARTBEAT_MS: '1000',
      REPORT_WORKER_LEASE_MS: '5000',
    }),
  );

  assert.equal(await worker.runOnce(), true);
  assert.ok(beats >= 1);
  assert.equal(state.completed.length, 0);
  assert.equal(state.failures.length, 0);
});

test('worker exits its polling loop on shutdown signal', async () => {
  const { claim: reportClaim } = claim(0);
  let claims = 0;
  const state = repositoryFor(reportClaim, candidates());
  const repository: ReportRepository = {
    ...state.repository,
    claim: async () => {
      claims += 1;
      return null;
    },
  };
  const usage = usageRepository();
  const worker = new ReportWorker(
    repository,
    {
      generate: async () => ({ connections: [], related: [] }),
      validate: async () => ({ status: 'PASS', reason: 'ok' }),
    },
    usage.repository,
    logger(),
    configuration({ REPORT_WORKER_POLL_MS: '100' }),
  );
  const controller = new AbortController();
  const running = worker.runForever(100, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await running;
  assert.ok(claims >= 1);
});

test('withdrawn recommendation is omitted without failing input analysis', async () => {
  const { claim: current } = claim(2);
  const hidden = issue();
  const snapshot = { ...candidates(), major: [hidden], majorCategoryCodes: ['ECONOMY'] };
  const state = repositoryFor(current, snapshot, {
    visibility: async (ids) => ids.filter((id) => id !== hidden.issueId),
  });
  const usage = usageRepository();
  const worker = new ReportWorker(
    state.repository,
    {
      generate: async () => {
        throw new Error('AI must not be called');
      },
      validate: async () => {
        throw new Error('AI must not be called');
      },
    },
    usage.repository,
    logger(),
    configuration(),
  );
  await worker.runOnce();
  assert.equal(state.failures.length, 0);
  assert.equal(state.completed[0]?.analysisStatus, 'INSUFFICIENT_DATA');
  assert.deepEqual(state.completed[0]?.majorIssues, []);
  assert.equal(usage.starts.length, 0);
});

test('worker applies a recommendation withdrawal observed by the final visibility check', async () => {
  const { claim: current } = claim(2);
  const withdrawn = issue();
  const snapshot = { ...candidates(), major: [withdrawn], majorCategoryCodes: ['ECONOMY'] };
  let visibilityReads = 0;
  const state = repositoryFor(current, snapshot, {
    visibility: async (ids) => {
      visibilityReads += 1;
      return visibilityReads === 1 ? ids : ids.filter((id) => id !== withdrawn.issueId);
    },
  });
  const usage = usageRepository();
  const worker = new ReportWorker(
    state.repository,
    {
      generate: async () => {
        throw new Error('AI must not be called');
      },
      validate: async () => {
        throw new Error('AI must not be called');
      },
    },
    usage.repository,
    logger(),
    configuration(),
  );

  await worker.runOnce();
  assert.equal(visibilityReads, 2);
  assert.deepEqual(state.completed[0]?.majorIssues, []);
  assert.equal(state.completed[0]?.recommendationsStatus, 'PARTIAL');
  assert.equal(state.failures.length, 0);
});
