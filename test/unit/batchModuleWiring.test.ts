import 'reflect-metadata';

import assert from 'node:assert/strict';
import { test } from '@jest/globals';

let runtimePromise: Promise<{
  BatchModule: typeof import('@newtine/batch/batch.module.js').BatchModule;
  BATCH_JOB: symbol;
  CoreModule: typeof import('@newtine/core').CoreModule;
  Test: typeof import('@nestjs/testing').Test;
  TestCoreModule: new () => object;
}>;

async function loadRuntime(): Promise<Awaited<typeof runtimePromise>> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    // Load Nest's ESM packages before the CJS nestjs-pino dependency graph to
    // keep Jest's VM-module loader from issuing a concurrent require().
    await import('@nestjs/common');
    const { Test } = await import('@nestjs/testing');
    const { EntityManager, MikroORM } = await import('@mikro-orm/core');
    const { BatchModule } = await import('@newtine/batch/batch.module.js');
    const { BATCH_JOB } = await import('@newtine/batch/runner/batch.job.js');
    const { CoreModule, PIPELINE_RUN_REPOSITORY } = await import('@newtine/core');
    const { REPORT_CONTENT_PROVIDER } = await import('@newtine/core/report/report.content.js');
    const { AI_USAGE_REPOSITORY, REPORT_REPOSITORY } = await import(
      '@newtine/core/report/report.model.js'
    );
    const { Module } = await import('@nestjs/common');

    @Module({
      providers: [
        { provide: MikroORM, useValue: {} },
        { provide: EntityManager, useValue: {} },
        { provide: REPORT_REPOSITORY, useValue: {} },
        { provide: REPORT_CONTENT_PROVIDER, useValue: {} },
        { provide: AI_USAGE_REPOSITORY, useValue: {} },
        { provide: PIPELINE_RUN_REPOSITORY, useValue: {} },
      ],
      exports: [
        MikroORM,
        EntityManager,
        REPORT_REPOSITORY,
        REPORT_CONTENT_PROVIDER,
        AI_USAGE_REPOSITORY,
        PIPELINE_RUN_REPOSITORY,
      ],
    })
    class TestCoreModule {}

    return { BatchModule, BATCH_JOB, CoreModule, Test, TestCoreModule };
  })();
  return runtimePromise;
}

test.each([
  ['databaseCheck', 'DatabaseCheckBatchJob'],
  ['reportWorker', 'ReportBatchJob'],
  ['pipelineWorker', 'PipelineBatchJob'],
  ['pipelineEmbeddingRepair', 'PipelineEmbeddingRepairBatchJob'],
] as const)('%s 역할이 해당 배치 작업으로 연결된다', async (jobName, expectedClassName) => {
  const { BatchModule, BATCH_JOB, CoreModule, Test, TestCoreModule } = await loadRuntime();
  const testingModule = await Test.createTestingModule({
    imports: [BatchModule.forRole(jobName)],
  })
    .overrideModule(CoreModule)
    .useModule(TestCoreModule)
    .compile();

  try {
    const job = testingModule.get(BATCH_JOB);
    assert.equal(job.constructor.name, expectedClassName);
  } finally {
    await testingModule.close();
  }
});
