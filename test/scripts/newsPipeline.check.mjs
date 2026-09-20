import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs, runPipeline } from '../../scripts/news-pipeline.mjs';
const names = ['discovery', 'collection', 'generation', 'validation'];
const model = 'gpt-5.4-mini-2026-03-17';
async function setup(t) {
  const output = await mkdtemp(join(tmpdir(), 'news-runner-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  return output;
}
function fake(calls, fail) {
  return async (script, args, { env }) => {
    calls.push({ script, args });
    const stage = names.find((name) => script === `scripts/news-${name}.mjs`);
    if (!stage) return { report: args[3] };
    if (fail?.(stage)) throw new Error('TEST_UPSTREAM_FAILURE');
    const directory = env[`NEWS_${stage.toUpperCase()}_DATA_DIR`];
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'result.json');
    await writeFile(
      file,
      JSON.stringify({
        usage: [{ model: env.PIPELINE_AI_MODEL || model, inputTokens: 100, outputTokens: 10 }],
        results: [],
      }),
    );
    return {
      runId: randomUUID(),
      completed: true,
      file,
      ...(stage === 'discovery'
        ? { queryCount: 1, candidateCount: 1 }
        : { [`${names[names.indexOf(stage) - 1]}RunId`]: args[1], counts: { DONE: 1 } }),
    };
  };
}
test('runner connects all stage IDs, writes usage report and does not rerun completed stages', async (t) => {
  const output = await setup(t),
    calls = [];
  const deps = { execute: fake(calls), env: {}, log: () => {} };
  const run = await runPipeline(parseArgs(['--output', output]), deps);
  assert.equal(calls.length, 5);
  for (let i = 1; i < 4; i++) assert.equal(calls[i].args[1], run.stages[names[i - 1]].runId);
  assert.match(await readFile(run.summary, 'utf8'), /0\.000/);
  calls.length = 0;
  await runPipeline(parseArgs(['--resume', run.manifest]), deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, 'scripts/news-pipeline-report.mjs');
});
test('failed stage resumes after persisted stages without skipping the failed stage', async (t) => {
  const output = await setup(t),
    calls = [];
  let failed = false;
  await assert.rejects(
    runPipeline(parseArgs(['--output', output]), {
      execute: fake(calls, (stage) => stage === 'generation' && !failed && (failed = true)),
      env: {},
      log: () => {},
    }),
    /TEST_UPSTREAM_FAILURE/,
  );
  const manifest = join(output, 'manifest.json');
  assert.deepEqual(Object.keys(JSON.parse(await readFile(manifest, 'utf8')).stages), [
    'discovery',
    'collection',
  ]);
  calls.length = 0;
  await runPipeline(parseArgs(['--resume', manifest]), {
    execute: fake(calls),
    env: {},
    log: () => {},
  });
  assert.deepEqual(
    calls.map((c) => c.script),
    [
      'scripts/news-generation.mjs',
      'scripts/news-validation.mjs',
      'scripts/news-pipeline-report.mjs',
    ],
  );
});
test('partial run only invokes selected stage and unknown model cost is not zero', async (t) => {
  const output = await setup(t),
    calls = [],
    source = randomUUID();
  const run = await runPipeline(
    parseArgs(['--from', '3', '--to', '3', '--source', source, '--output', output]),
    { execute: fake(calls), env: { PIPELINE_AI_MODEL: 'other-model' }, log: () => {} },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[1], source);
  assert.match(await readFile(run.summary, 'utf8'), /산정 불가/);
  const before = await readFile(run.manifest, 'utf8');
  await assert.rejects(
    runPipeline(parseArgs(['--resume', run.manifest]), {
      execute: fake(calls),
      env: {},
      log: () => {},
    }),
    /RESUME_MODEL_CHANGED/,
  );
  assert.equal(await readFile(run.manifest, 'utf8'), before);
});
test('invalid CLI ranges and source IDs fail before execution', () => {
  for (const args of [
    ['--from', '0'],
    ['--to', '5'],
    ['--from', '3', '--to', '2'],
    ['--from', '2'],
    ['--source', randomUUID()],
    ['--resume', 'a', '--to', '4'],
    ['--to', '1', '--to', '2'],
  ])
    assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['--help']).help, true);
});
test('concurrent runner on same directory cannot launch another child', async (t) => {
  const output = await setup(t),
    calls = [];
  await writeFile(join(output, '.runner.lock'), 'already running');
  await assert.rejects(
    runPipeline(parseArgs(['--output', output]), { execute: fake(calls), env: {}, log: () => {} }),
    /PIPELINE_RUNNER_LOCKED/,
  );
  assert.equal(calls.length, 0);
});
test('mismatched stage source is rejected without recording a completed result', async (t) => {
  const output = await setup(t),
    calls = [],
    source = randomUUID();
  const run = fake(calls);
  await assert.rejects(
    runPipeline(parseArgs(['--from', '3', '--to', '3', '--source', source, '--output', output]), {
      env: {},
      log: () => {},
      execute: async (...args) => ({ ...(await run(...args)), collectionRunId: randomUUID() }),
    }),
    /PIPELINE_SOURCE_MISMATCH/,
  );
  assert.deepEqual(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')).stages, {});
});
