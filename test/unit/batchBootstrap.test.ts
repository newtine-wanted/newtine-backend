import 'reflect-metadata';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from '@jest/globals';

import { resolveBatchJobName } from '@newtine/batch/runner/batch.role.js';

test('배치 역할 파서는 명시된 작업만 허용한다', () => {
  assert.equal(resolveBatchJobName('reportWorker'), 'reportWorker');
  assert.equal(resolveBatchJobName('pipelineWorker'), 'pipelineWorker');
  assert.equal(resolveBatchJobName('databaseCheck'), 'databaseCheck');
  assert.equal(resolveBatchJobName('pipelineEmbeddingRepair'), 'pipelineEmbeddingRepair');
  assert.equal(resolveBatchJobName(undefined), undefined);
  assert.equal(resolveBatchJobName('unknown'), undefined);
});

test('리포트 모듈은 파이프라인 설정을 참조하지 않는다', () => {
  const batchModule = readFileSync('apps/batch/src/batch.module.ts', 'utf8');
  const reportModule = readFileSync('apps/batch/src/report/report.batch.module.ts', 'utf8');

  assert.match(batchModule, /static forRole/);
  assert.doesNotMatch(batchModule, /PipelineAiConfiguration/);
  assert.doesNotMatch(reportModule, /PipelineAiConfiguration/);
  assert.match(batchModule, /PipelineBatchModule\.forJob\(jobName\)/);
});

test('파이프라인 설정은 파이프라인 역할 모듈에 한정된다', () => {
  const pipelineModule = readFileSync('apps/batch/src/pipeline/pipeline.batch.module.ts', 'utf8');
  const databaseModule = readFileSync(
    'apps/batch/src/job/databaseCheck/databaseCheck.batch.module.ts',
    'utf8',
  );

  assert.match(pipelineModule, /PipelineAiConfiguration/);
  assert.doesNotMatch(databaseModule, /PipelineAiConfiguration/);
});
