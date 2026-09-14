import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  InMemoryPipelineRepository,
  PipelineException,
  PipelineExceptionCode,
  generateUuidV7,
  normalizePipelineLimits,
  type EmbeddingProvider,
  type FetchedArticle,
  type GeneratedIssueContent,
  type SemanticValidationResult,
} from '@newtine/core';
import { PipelineEmbeddingRepairJob } from '@newtine/batch/pipeline/pipeline.embeddingRepair.job.js';

function content(
  articleIds: [ReturnType<typeof generateUuidV7>, ReturnType<typeof generateUuidV7>],
): GeneratedIssueContent {
  return {
    integratedSummary: '공개된 이슈의 핵심 요약',
    summaryLines: ['첫째', '둘째', '셋째'],
    viewpoints: [{ statement: '확인된 주장', articleIds: [articleIds[0]] }],
    glossary: [],
    impacts: [],
  };
}

function evidence(
  articleIds: [ReturnType<typeof generateUuidV7>, ReturnType<typeof generateUuidV7>],
): FetchedArticle[] {
  return articleIds.map((articleId, index) => ({
    articleId,
    title: `근거 기사 ${index + 1}`,
    sourceUrl: `https://news.example/evidence/${index + 1}`,
    publisherName: `publisher-${index + 1}`,
    body: '본문 '.repeat(40),
  }));
}

async function createPendingTask(repository: InMemoryPipelineRepository) {
  const run = await repository.enqueue({
    idempotencyKey: `embedding-repair-${generateUuidV7()}`,
    requestHash: `embedding-repair-${generateUuidV7()}`,
    request: { query: '정책', limits: normalizePipelineLimits() },
  });
  const executionId = generateUuidV7();
  const work = await repository.claimNext(executionId);
  assert.ok(work);
  const [seed] = await repository.saveDiscoveredArticles(run.id, [
    {
      title: '시드 기사',
      description: '설명',
      sourceUrl: 'https://news.example/seed',
      publisherName: 'publisher',
    },
  ]);
  assert.ok(seed?.id);
  const registration = await repository.registerIssue({
    runId: run.id,
    attempt: 1,
    candidate: {
      disposition: 'NEW',
      reason: 'new',
      candidate: {
        title: '임베딩 보완 이슈',
        scope: '정책',
        confirmedFacts: ['사실'],
        sourceArticleIds: [seed.id],
        categoryCode: 'politics',
      },
    },
    seedArticles: [seed],
  });
  assert.equal(registration.outcome, 'created');
  if (registration.outcome !== 'created') throw new Error('job should be created');
  assert.ok(await repository.claimJob(registration.job.id, 1, executionId));
  const articleIds = [generateUuidV7(), generateUuidV7()] as [
    ReturnType<typeof generateUuidV7>,
    ReturnType<typeof generateUuidV7>,
  ];
  const articles = evidence(articleIds);
  const validation: SemanticValidationResult = {
    status: 'PASS',
    reason: '두 독립 근거',
    independentEvidenceGroups: [[articleIds[0]], [articleIds[1]]],
    conflicts: [],
  };
  assert.equal(
    await repository.saveJobSuccess(
      registration.job.id,
      1,
      executionId,
      content(articleIds),
      validation,
      articles,
    ),
    true,
  );
  return { run, executionId, job: registration.job, issueId: registration.job.issueId };
}

function setPublicationStatus(
  repository: InMemoryPipelineRepository,
  issueId: ReturnType<typeof generateUuidV7>,
  publicationStatus: 'PUBLISHED' | 'WITHDRAWN',
): void {
  const state = repository as unknown as {
    issues: Array<{ id: ReturnType<typeof generateUuidV7>; publicationStatus: string }>;
  };
  const issue = state.issues.find((item) => item.id === issueId);
  assert.ok(issue);
  issue.publicationStatus = publicationStatus;
}

class WithdrawnAfterClaimRepository extends InMemoryPipelineRepository {
  override async claimPendingEmbeddingTasks(
    limit: number,
    processExecutionId: ReturnType<typeof generateUuidV7>,
    claimToken: ReturnType<typeof generateUuidV7>,
  ) {
    const tasks = await super.claimPendingEmbeddingTasks(limit, processExecutionId, claimToken);
    for (const task of tasks) setPublicationStatus(this, task.issueId, 'WITHDRAWN');
    return tasks;
  }
}

class AbortAfterClaimRepository extends InMemoryPipelineRepository {
  constructor(private readonly controller: AbortController) {
    super();
  }

  override async claimPendingEmbeddingTasks(
    limit: number,
    processExecutionId: ReturnType<typeof generateUuidV7>,
    claimToken: ReturnType<typeof generateUuidV7>,
  ) {
    const tasks = await super.claimPendingEmbeddingTasks(limit, processExecutionId, claimToken);
    this.controller.abort();
    return tasks;
  }
}

function logger() {
  return {
    setContext: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as never;
}

class PersistenceFailingRepository extends InMemoryPipelineRepository {
  override async saveEmbedding(): Promise<'SAVED' | 'STALE'> {
    throw new Error('database unavailable after provider success');
  }
}

test('published content leaves a durable pending task that repair can complete after a worker crash', async () => {
  const repository = new InMemoryPipelineRepository();
  const pending = await createPendingTask(repository);
  assert.equal((await repository.findById(pending.run.id))?.embeddingPendingCount, 1);
  const tasks = await repository.listPendingEmbeddingTasks(10);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.issueId, pending.issueId);
  assert.equal(tasks[0]?.runExecutionId, pending.executionId);
  const expectedModel = tasks[0]!.model;

  let calls = 0;
  let requestedModel: string | undefined;
  const embeddingProvider: EmbeddingProvider = {
    embed: async (_input, model) => {
      calls += 1;
      requestedModel = model;
      return { model: 'text-embedding-3-small', vector: new Array(1_536).fill(0) };
    },
  };
  const repair = new PipelineEmbeddingRepairJob(repository, embeddingProvider, logger());
  await repair.run(generateUuidV7());

  assert.equal(calls, 1);
  assert.equal(requestedModel, expectedModel);
  assert.equal((await repository.findById(pending.run.id))?.embeddingPendingCount, 0);
  assert.equal((await repository.listPendingEmbeddingTasks(10)).length, 0);
});

test('withdrawn issues are fenced out of embedding repair paths', async () => {
  const repository = new InMemoryPipelineRepository();
  const pending = await createPendingTask(repository);
  const task = (await repository.listPendingEmbeddingTasks(10))[0]!;
  setPublicationStatus(repository, pending.issueId, 'WITHDRAWN');

  assert.equal(
    (await repository.claimPendingEmbeddingTasks(10, generateUuidV7(), generateUuidV7())).length,
    0,
  );
  assert.equal((await repository.listPendingEmbeddingTasks(10)).length, 0);
  assert.equal(
    await repository.saveEmbedding(
      pending.issueId,
      task.title,
      task.integratedSummary,
      new Array(1_536).fill(0),
      task.model,
    ),
    'STALE',
  );

  const state = repository as unknown as {
    embeddingTasks: Map<ReturnType<typeof generateUuidV7>, { attempts: number; status: string }>;
  };
  const stored = state.embeddingTasks.get(pending.issueId)!;
  const attemptsBefore = stored.attempts;
  await repository.markEmbeddingPending(
    pending.run.id,
    pending.run.attempt,
    pending.executionId,
    pending.job.id,
    'withdrawn',
  );
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.attempts, attemptsBefore);
  assert.equal((await repository.findById(pending.run.id))?.embeddingPendingCount, 0);
});

test('repair rechecks publication before the provider and releases a withdrawn claim', async () => {
  const repository = new WithdrawnAfterClaimRepository();
  const pending = await createPendingTask(repository);
  let calls = 0;
  const embeddingProvider: EmbeddingProvider = {
    embed: async () => {
      calls += 1;
      return { model: 'text-embedding-3-small', vector: new Array(1_536).fill(0) };
    },
  };
  const repair = new PipelineEmbeddingRepairJob(repository, embeddingProvider, logger());

  await repair.run(generateUuidV7());

  assert.equal(calls, 0);
  const state = repository as unknown as {
    embeddingTasks: Map<
      ReturnType<typeof generateUuidV7>,
      {
        status: string;
        claimToken?: ReturnType<typeof generateUuidV7>;
      }
    >;
  };
  const task = state.embeddingTasks.get(pending.issueId);
  assert.equal(task?.status, 'PENDING');
  assert.equal(task?.claimToken, undefined);
});

test('repair stops after shutdown and releases claims it did not start', async () => {
  const controller = new AbortController();
  const repository = new AbortAfterClaimRepository(controller);
  const pending = await createPendingTask(repository);
  let calls = 0;
  const embeddingProvider: EmbeddingProvider = {
    embed: async () => {
      calls += 1;
      return { model: 'text-embedding-3-small', vector: new Array(1_536).fill(0) };
    },
  };
  const owner = generateUuidV7();
  const repair = new PipelineEmbeddingRepairJob(repository, embeddingProvider, logger());

  await repair.run(owner, undefined, controller.signal);

  assert.equal(calls, 0);
  const state = repository as unknown as {
    embeddingTasks: Map<
      ReturnType<typeof generateUuidV7>,
      {
        status: string;
        claimedByProcessExecutionId?: ReturnType<typeof generateUuidV7>;
      }
    >;
  };
  const task = state.embeddingTasks.get(pending.issueId);
  assert.equal(task?.status, 'PENDING');
  assert.equal(task?.claimedByProcessExecutionId, undefined);
  assert.equal((await repository.listPendingEmbeddingTasks(10)).length, 1);
});

test('embedding success is not regressed to pending by a later maintenance failure', async () => {
  const repository = new InMemoryPipelineRepository();
  const pending = await createPendingTask(repository);
  const task = (await repository.listPendingEmbeddingTasks(10))[0]!;
  assert.equal(
    await repository.saveEmbedding(
      pending.issueId,
      task.title,
      task.integratedSummary,
      new Array(1_536).fill(0),
      task.model,
    ),
    'SAVED',
  );

  const state = repository as unknown as {
    embeddingTasks: Map<ReturnType<typeof generateUuidV7>, { attempts: number; status: string }>;
  };
  const stored = state.embeddingTasks.get(pending.issueId)!;
  const attemptsAfterSuccess = stored.attempts;
  await repository.markEmbeddingPending(
    pending.run.id,
    pending.run.attempt,
    pending.executionId,
    pending.job.id,
    'provider failed after an existing success',
  );
  assert.equal(stored.status, 'SUCCEEDED');
  assert.equal(stored.attempts, attemptsAfterSuccess);
  assert.equal((await repository.findById(pending.run.id))?.embeddingPendingCount, 0);
});

test('stale embedding input cannot complete a newer pending task', async () => {
  const repository = new InMemoryPipelineRepository();
  const pending = await createPendingTask(repository);
  const task = (await repository.listPendingEmbeddingTasks(10))[0]!;

  await repository.saveEmbedding(
    pending.issueId,
    task.title,
    `${task.integratedSummary} (stale)`,
    new Array(1_536).fill(0),
    task.model,
  );

  assert.equal((await repository.findById(pending.run.id))?.embeddingPendingCount, 1);
  assert.equal((await repository.listPendingEmbeddingTasks(10)).length, 1);
});

test('repair failure keeps the task pending for the next manual run', async () => {
  const repository = new InMemoryPipelineRepository();
  const pending = await createPendingTask(repository);
  const embeddingProvider: EmbeddingProvider = {
    embed: async () => {
      throw new PipelineException(PipelineExceptionCode.UpstreamError, 'network timeout', {
        retryable: true,
        resultUncertain: true,
      });
    },
  };
  const repair = new PipelineEmbeddingRepairJob(repository, embeddingProvider, logger());
  await repair.run(generateUuidV7());

  const tasks = await repository.listPendingEmbeddingTasks(10);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.attempts, 1);
  assert.equal((await repository.findById(pending.run.id))?.embeddingPendingCount, 1);
  assert.equal((await repository.findById(pending.run.id))?.usageSummary.calls, 1);
  assert.equal((await repository.findById(pending.run.id))?.usageSummary.unknownCalls, 1);
});

test('known retryable provider failures are recorded as failed rather than unknown', async () => {
  const repository = new InMemoryPipelineRepository();
  const pending = await createPendingTask(repository);
  const embeddingProvider: EmbeddingProvider = {
    embed: async () => {
      throw new PipelineException(PipelineExceptionCode.UpstreamError, 'HTTP 429', {
        retryable: true,
      });
    },
  };
  const repair = new PipelineEmbeddingRepairJob(repository, embeddingProvider, logger());
  await repair.run(generateUuidV7());

  const usage = (await repository.findById(pending.run.id))?.usageSummary;
  assert.equal(usage?.calls, 1);
  assert.equal(usage?.failedCalls, 1);
  assert.equal(usage?.unknownCalls, 0);
});

test('embedding repair claims are exclusive and only a confirmed-dead owner can be requeued', async () => {
  const repository = new InMemoryPipelineRepository();
  const pending = await createPendingTask(repository);
  const ownerA = generateUuidV7();
  const tokenA = generateUuidV7();
  const [task] = await repository.claimPendingEmbeddingTasks(10, ownerA, tokenA);
  assert.ok(task);
  assert.equal(
    (await repository.claimPendingEmbeddingTasks(10, generateUuidV7(), generateUuidV7())).length,
    0,
  );
  assert.equal(
    await repository.saveEmbedding(
      pending.issueId,
      task.title,
      task.integratedSummary,
      new Array(1_536).fill(0),
      task.model,
      task.id,
      generateUuidV7(),
      task.model,
    ),
    'STALE',
  );
  assert.equal(await repository.requeueEmbeddingClaims(generateUuidV7()), 0);
  assert.equal(await repository.requeueEmbeddingClaims(ownerA), 1);
  const ownerB = generateUuidV7();
  const tokenB = generateUuidV7();
  const [reclaimed] = await repository.claimPendingEmbeddingTasks(10, ownerB, tokenB);
  assert.ok(reclaimed);
  assert.equal(
    await repository.saveEmbedding(
      pending.issueId,
      reclaimed.title,
      reclaimed.integratedSummary,
      new Array(1_536).fill(0),
      reclaimed.model,
      reclaimed.id,
      tokenB,
      reclaimed.model,
    ),
    'SAVED',
  );
  assert.equal(tokenA === tokenB, false);
});

test('provider model mismatch is recorded once and remains repairable', async () => {
  const repository = new InMemoryPipelineRepository();
  const pending = await createPendingTask(repository);
  const embeddingProvider: EmbeddingProvider = {
    embed: async () => ({ model: 'different-model', vector: new Array(1_536).fill(0) }),
  };
  const repair = new PipelineEmbeddingRepairJob(repository, embeddingProvider, logger());
  await repair.run(generateUuidV7());

  assert.equal((await repository.findById(pending.run.id))?.usageSummary.calls, 1);
  assert.equal((await repository.findById(pending.run.id))?.usageSummary.failedCalls, 1);
  assert.equal((await repository.listPendingEmbeddingTasks(10)).length, 1);
});

test('persistence failure requeues the claim without a second provider usage record', async () => {
  const repository = new PersistenceFailingRepository();
  const pending = await createPendingTask(repository);
  const embeddingProvider: EmbeddingProvider = {
    embed: async () => ({ model: 'text-embedding-3-small', vector: new Array(1_536).fill(0) }),
  };
  const repair = new PipelineEmbeddingRepairJob(repository, embeddingProvider, logger());
  await repair.run(generateUuidV7());

  const snapshot = await repository.findById(pending.run.id);
  assert.equal(snapshot?.usageSummary.calls, 1);
  assert.equal(snapshot?.usageSummary.succeededCalls, 1);
  assert.equal(snapshot?.usageSummary.failedCalls, 0);
  assert.equal((await repository.listPendingEmbeddingTasks(10)).length, 1);
});
