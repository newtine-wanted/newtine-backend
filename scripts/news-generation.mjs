/* global console, process, AbortController */
import 'reflect-metadata';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MikroORM } from '@mikro-orm/postgresql';
import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';
import { GenerationRepository } from '../dist/apps/batch/src/generation/generation.repository.js';
import { GenerationService } from '../dist/apps/batch/src/generation/generation.service.js';
import { GenerationOpenAiModel } from '../dist/apps/batch/src/generation/generation.model.js';
import { parseGenerationConfig } from '../dist/apps/batch/src/generation/generation.policy.js';
import { NaverArticleBodyProvider } from '../dist/apps/batch/src/pipeline/naverNews.provider.js';

export async function generationOrm() {
  const options = createDatabaseOptions();
  return MikroORM.init(options);
}
import { writeGenerationReport } from './news-generation-report.mjs';

async function main() {
  const command = process.argv[2] ?? 'run';
  if (!['run', 'plan'].includes(command)) throw new Error('UNKNOWN_GENERATION_COMMAND');
  const config = parseGenerationConfig(
    JSON.parse(
      await readFile(process.env.NEWS_GENERATION_CONFIG ?? 'config/news-generation.json', 'utf8'),
    ),
  );
  if (command === 'plan') {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  const source = process.argv[3];
  if (command === 'run' && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(source ?? ''))
    throw new Error('COLLECTION_RUN_ID_REQUIRED');
  const orm = await generationOrm();
  try {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const service = new GenerationService(
        new GenerationRepository(orm.em.fork()),
        new NaverArticleBodyProvider(),
        new GenerationOpenAiModel(
          process.env.OPENAI_API_KEY ?? '',
          await readFile('docs/news-pipeline/direction/ux-writing.md', 'utf8'),
        ),
        (event) => console.log(JSON.stringify({ event: 'news.generation.progress', ...event })),
      );
      const run = await service.execute(source, config, new Date(), controller.signal);
      const directory = resolve(process.env.NEWS_GENERATION_DATA_DIR ?? '.local/news-generation');
      await mkdir(directory, { recursive: true });
      const file = resolve(directory, `${run.collectionRunId}-generated.json`);
      await writeFile(file, JSON.stringify(run.snapshot, null, 2));
      await writeGenerationReport(run, resolve(directory, `${run.collectionRunId}-report.md`));
      const counts = Object.fromEntries(
        ['GENERATED', 'INSUFFICIENT_BODIES'].map((s) => [
          s,
          run.snapshot.results.filter((r) => r.status === s).length,
        ]),
      );
      console.log(
        JSON.stringify({
          runId: run.id,
          collectionRunId: run.collectionRunId,
          completed: run.completed,
          counts,
          file,
        }),
      );
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  } finally {
    await orm.close(true);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(
      error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)
        ? error.message
        : 'GENERATION_FAILED',
    );
    process.exitCode = 1;
  });
}
