/* global process */

import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();

async function exists(relativePath) {
  await access(join(root, relativePath));
}

test('Dockerfile은 API와 배치 대상을 노출하고 API를 기본값으로 사용한다', async () => {
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, /FROM runtime-deps AS api/);
  assert.match(dockerfile, /FROM runtime-deps AS batch/);
  assert.match(dockerfile, /FROM api AS runtime/);
  assert.match(dockerfile, /CMD \["node", "dist\/apps\/api\/src\/main\.js"\]/);
  assert.match(dockerfile, /CMD \["node", "dist\/apps\/batch\/src\/main\.js"\]/);
  assert.match(dockerfile, /COPY --chown=node:node scripts\/news-\*\.mjs \.\/scripts\//);
  assert.match(dockerfile, /COPY --chown=node:node prompts\/news-pipeline/);
  assert.match(dockerfile, /COPY --chown=node:node docs\/news-pipeline\/direction/);
});

test('배치 이미지에 필요한 소스 자산이 존재한다', async () => {
  const scripts = await readdir(join(root, 'scripts'));
  for (const name of [
    'news-pipeline.mjs',
    'news-discovery.mjs',
    'news-collection.mjs',
    'news-generation.mjs',
    'news-validation.mjs',
    'news-pipeline-report.mjs',
    'news-generation-report.mjs',
    'news-validation-report.mjs',
    'news-pipeline-prepare.mjs',
  ]) {
    assert.ok(scripts.includes(name), 'missing batch CLI asset: ' + name);
  }
  await exists('prompts/news-pipeline/README.md');
  await exists('docs/news-pipeline/direction/ux-writing.md');
  await exists('config/pipeline-ai.yml');
});

test('Compose는 모든 애플리케이션 이미지 소비자에 대상을 지정한다', async () => {
  const compose = await readFile(join(root, 'compose.yaml'), 'utf8');
  assert.equal((compose.match(/target: api/g) ?? []).length, 2);
  assert.equal((compose.match(/target: batch/g) ?? []).length, 2);
  assert.match(compose, /command: \["node", "dist\/apps\/batch\/src\/main\.js", "reportWorker"\]/);
});

test('Cloud Build는 배치 이미지를 푸시하지만 Worker Pool은 자동 배포하지 않는다', async () => {
  const cloudbuild = await readFile(join(root, 'cloudbuild.yaml'), 'utf8');
  assert.match(cloudbuild, /_BATCH_IMAGE: newtine-batch/);
  assert.match(cloudbuild, /id: build-api-image/);
  assert.match(cloudbuild, /id: build-batch-image/);
  assert.match(cloudbuild, /id: push-batch-image/);
  assert.match(cloudbuild, /- --target\s+- batch/);
  assert.doesNotMatch(cloudbuild, /worker-pools deploy/);
});

test('리포트 배포 정의는 워커 명령과 비밀 경계를 고정한다', async () => {
  const readme = await readFile(join(root, 'deploy/cloud-run/report-worker/README.md'), 'utf8');
  assert.match(readme, /worker-pools deploy newtine-report-worker/);
  assert.match(readme, /--args dist\/apps\/batch\/src\/main\.js,reportWorker/);
  assert.match(readme, /--update-secrets OPENAI_API_KEY=/);
  assert.match(readme, /--update-secrets .*DB_PASSWORD=/);
});
