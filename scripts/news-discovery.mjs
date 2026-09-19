/* global console, process, AbortController */
import 'reflect-metadata';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MikroORM } from '@mikro-orm/postgresql';
import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';
import { Migration20260920000000NewsDiscovery } from '../dist/apps/batch/src/discovery/discovery.migration.js';
import { DiscoveryRepository } from '../dist/apps/batch/src/discovery/discovery.repository.js';
import { DiscoveryService } from '../dist/apps/batch/src/discovery/discovery.service.js';
import { DiscoveryOpenAiModel } from '../dist/apps/batch/src/discovery/discovery.model.js';
import { parseDiscoveryConfig } from '../dist/apps/batch/src/discovery/discovery.policy.js';
import { NaverNewsProvider } from '../dist/apps/batch/src/pipeline/naverNews.provider.js';

export async function discoveryOrm() {
  const options = createDatabaseOptions();
  options.migrations.migrationsList.push(Migration20260920000000NewsDiscovery);
  return MikroORM.init(options);
}
async function main() {
  const command = process.argv[2] ?? 'run';
  if (!['run', 'plan', 'migrate'].includes(command)) throw new Error('UNKNOWN_DISCOVERY_COMMAND');
  const directory = resolve(process.env.NEWS_DISCOVERY_DATA_DIR ?? '.local/news-discovery');
  const config = parseDiscoveryConfig(
    JSON.parse(
      await readFile(process.env.NEWS_DISCOVERY_CONFIG ?? 'config/news-discovery.json', 'utf8'),
    ),
  );
  const orm = await discoveryOrm();
  try {
    if (command === 'migrate') {
      await orm.migrator.up();
      console.log('Discovery migrations applied');
      return;
    }
    const store = new DiscoveryRepository(orm.em.fork(), config.entityTypes);
    if (command === 'plan') {
      console.log(
        JSON.stringify(
          { config, queries: await store.catalog(new Date(Date.now() - 86400_000).toISOString()) },
          null,
          2,
        ),
      );
      return;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const service = new DiscoveryService(
        store,
        new NaverNewsProvider(),
        new DiscoveryOpenAiModel(process.env.OPENAI_API_KEY ?? ''),
        (event) => console.log(JSON.stringify({ event: 'news.discovery.progress', ...event })),
      );
      const run = await service.execute(config, new Date(), controller.signal);
      await mkdir(directory, { recursive: true });
      const file = resolve(directory, `${run.day}-candidates.json`);
      await writeFile(file, JSON.stringify(run.snapshot, null, 2));
      console.log(
        JSON.stringify({
          runId: run.id,
          day: run.day,
          completed: run.completed,
          queryCount: run.snapshot.results.length,
          candidateCount: run.snapshot.candidates?.length ?? 0,
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
    console.error(error instanceof Error ? error.message : 'DISCOVERY_FAILED');
    process.exitCode = 1;
  });
}
