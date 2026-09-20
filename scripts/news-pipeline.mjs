/* global process, console, AbortController */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const STAGES = ['discovery', 'collection', 'generation', 'validation'];
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const HELP = `Usage: npm run news:pipeline -- [--from 1..4] [--to 1..4] [--source RUN_ID] [--output DIR]
       npm run news:pipeline -- --resume PATH/manifest.json

Build first: npm run build:batch
Apply deploy/db/news-pipeline/001_schema.sql to the prepared application DB first.
Reads .env without overriding existing environment variables.
--source is the preceding stage's run ID (required when --from > 1).
Completed DB runs are reused; this command never deletes runs or publishes issues.
`;
export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i],
      value = args[i + 1];
    if (
      !['--from', '--to', '--source', '--output', '--resume'].includes(flag) ||
      !value ||
      value.startsWith('--') ||
      flag in options
    )
      throw new Error('INVALID_PIPELINE_ARGUMENTS');
    options[flag] = value;
  }
  if (options['--resume']) {
    if (Object.keys(options).length !== 1) throw new Error('RESUME_OPTIONS_CONFLICT');
    return { resume: resolve(options['--resume']) };
  }
  const from = Number(options['--from'] ?? 1),
    to = Number(options['--to'] ?? 4);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 4 || from > to)
    throw new Error('INVALID_STAGE_RANGE');
  const source = options['--source'] ?? null;
  if ((from > 1 && !UUID.test(source ?? '')) || (from === 1 && source))
    throw new Error('PREVIOUS_STAGE_RUN_ID_REQUIRED');
  return {
    from,
    to,
    source,
    output: options['--output'] ? resolve(options['--output']) : undefined,
  };
}
async function save(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, path);
}
export function runCommand(script, args, { env, signal, log = console.log }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let result;
    const stdout = createInterface({ input: child.stdout });
    const stderr = createInterface({ input: child.stderr });
    stdout.on('line', (line) => {
      log(line);
      try {
        result = JSON.parse(line);
      } catch {
        /* Non-JSON logging is allowed. */
      }
    });
    stderr.on('line', (line) => log(line));
    const stop = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', stop);
      stdout.close();
      stderr.close();
      if (signal?.aborted) reject(new Error('PIPELINE_ABORTED'));
      else if (code !== 0) reject(new Error('PIPELINE_CHILD_FAILED'));
      else resolveRun(result);
    });
  });
}
async function writeSummary(state, directory) {
  const { estimateCost } = await import('../dist/apps/batch/src/generation/generation.policy.js');
  const rows = [];
  for (const name of STAGES) {
    const run = state.stages[name];
    if (!run) continue;
    const snapshot = JSON.parse(await readFile(run.file, 'utf8'));
    const usage = snapshot.usage ?? [];
    rows.push({
      stage: name,
      runId: run.runId,
      models: [...new Set(usage.map((u) => u.model))],
      calls: usage.length,
      inputTokens: usage.reduce((n, u) => n + (u.inputTokens ?? 0), 0),
      outputTokens: usage.reduce((n, u) => n + (u.outputTokens ?? 0), 0),
      cost: estimateCost(usage),
      counts: run.counts ?? { queries: run.queryCount, candidates: run.candidateCount },
    });
  }
  const incomplete = rows.some((r) => r.cost.incomplete);
  const totalUsd = rows.reduce((n, r) => n + r.cost.usd, 0);
  const lines = [
    '# 뉴스 파이프라인 실행 결과',
    '',
    '저장된 실행 사용량 기준입니다. DB 완료 결과를 재사용한 경우 과거 호출 비용도 포함하며 이번 명령의 추가 청구액을 뜻하지 않습니다.',
    '',
    '| 단계 | 실행 ID | 모델 | 결과 | 호출 | 입력 토큰 | 출력 토큰 | 추정 USD |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.stage} | ${r.runId} | ${r.models.join(', ') || '호출 없음'} | ${JSON.stringify(r.counts)} | ${r.calls} | ${r.inputTokens} | ${r.outputTokens} | ${r.cost.incomplete ? '산정 불가/일부 누락' : '$' + r.cost.usd.toFixed(6)} |`,
    ),
    '',
    incomplete
      ? `일부 비용 산정 불가. 확인된 비용만 $${totalUsd.toFixed(6)} USD입니다.`
      : `전체 저장 실행 추정 비용: $${totalUsd.toFixed(6)} USD.`,
    '등록된 기본 모델 단가만 사용하며 다른 모델의 비용을 0원으로 간주하지 않습니다. 캐시 기록·환율·세금에 따라 실제 청구액과 다를 수 있습니다.',
    '',
  ];
  await save(resolve(directory, 'summary.json'), { stages: rows, totalUsd, incomplete });
  await writeFile(resolve(directory, 'summary.md'), lines.join('\n'));
}
export async function runPipeline(
  options,
  { execute = runCommand, env = process.env, signal, log = console.log } = {},
) {
  const directory = options.resume
    ? dirname(options.resume)
    : (options.output ??
      resolve(
        '.local/news-pipeline',
        `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`,
      ));
  await mkdir(directory, { recursive: true });
  const manifest = options.resume ?? resolve(directory, 'manifest.json');
  const lockPath = resolve(directory, '.runner.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('PIPELINE_RUNNER_LOCKED');
    throw error;
  }
  const modelOverride = env.PIPELINE_AI_MODEL?.trim() || '';
  let state;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    if (options.resume) {
      const loaded = JSON.parse(await readFile(manifest, 'utf8'));
      if (
        loaded.version !== 1 ||
        !loaded.stages ||
        !Number.isInteger(loaded.from) ||
        !Number.isInteger(loaded.to)
      )
        throw new Error('INVALID_PIPELINE_MANIFEST');
      parseArgs([
        '--from',
        String(loaded.from),
        '--to',
        String(loaded.to),
        ...(loaded.from > 1 ? ['--source', loaded.source] : []),
      ]);
      if (loaded.modelOverride !== modelOverride) throw new Error('RESUME_MODEL_CHANGED');
      state = loaded;
    } else {
      if (existsSync(manifest)) throw new Error('USE_RESUME_FOR_EXISTING_MANIFEST');
      state = {
        version: 1,
        from: options.from,
        to: options.to,
        source: options.source,
        modelOverride,
        stages: {},
        createdAt: new Date().toISOString(),
      };
      await save(manifest, state);
    }
    log(JSON.stringify({ event: 'news.pipeline.manifest', manifest }));
    let source = state.source;
    for (let i = state.from - 1; i < state.to; i++) {
      signal?.throwIfAborted();
      const stage = STAGES[i];
      let result = state.stages[stage];
      if (!result) {
        result = await execute(`scripts/news-${stage}.mjs`, ['run', ...(source ? [source] : [])], {
          env: { ...env, [`NEWS_${stage.toUpperCase()}_DATA_DIR`]: resolve(directory, stage) },
          signal,
          log,
        });
        if (!result?.completed || !UUID.test(result.runId ?? '') || typeof result.file !== 'string')
          throw new Error('INVALID_STAGE_RESULT');
        if (i > 0 && result[`${STAGES[i - 1]}RunId`] !== source)
          throw new Error('PIPELINE_SOURCE_MISMATCH');
        state.stages[stage] = result;
        await save(manifest, state);
      }
      if (!result.completed || !UUID.test(result.runId ?? '') || typeof result.file !== 'string')
        throw new Error('INVALID_PIPELINE_MANIFEST');
      if (i > 0 && result[`${STAGES[i - 1]}RunId`] !== source)
        throw new Error('PIPELINE_SOURCE_MISMATCH');
      await readFile(result.file, 'utf8');
      source = result.runId;
    }
    await writeSummary(state, directory);
    if (state.from === 1 && state.to >= 3) {
      await execute(
        'scripts/news-pipeline-report.mjs',
        [
          state.stages.discovery.file,
          state.stages.collection.file,
          state.stages.generation.file,
          resolve(directory, 'results.md'),
          '',
          state.stages.validation?.file ?? '',
        ],
        { env, signal, log },
      );
    }
    state.completed = true;
    delete state.error;
    await save(manifest, state);
    return { manifest, summary: resolve(directory, 'summary.md'), stages: state.stages };
  } catch (error) {
    if (state) {
      state.completed = false;
      state.error = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '')
        ? error.message
        : 'PIPELINE_RUN_FAILED';
      await save(manifest, state);
    }
    throw error;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (!existsSync('dist/apps/batch/src/discovery/discovery.service.js'))
    throw new Error('BUILD_BATCH_FIRST');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    console.log(JSON.stringify(await runPipeline(options, { signal: controller.signal })));
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(
      /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'PIPELINE_RUN_FAILED',
    );
    process.exitCode = 1;
  });
}
