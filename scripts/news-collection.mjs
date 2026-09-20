/* global console, process, AbortController */
import 'reflect-metadata';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MikroORM } from '@mikro-orm/postgresql';
import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';
import { Migration20260920000000NewsDiscovery } from '../dist/apps/batch/src/discovery/discovery.migration.js';
import { Migration20260920000100NewsCollection } from '../dist/apps/batch/src/collection/collection.migration.js';
import { CollectionRepository } from '../dist/apps/batch/src/collection/collection.repository.js';
import { CollectionService } from '../dist/apps/batch/src/collection/collection.service.js';
import { CollectionOpenAiModel } from '../dist/apps/batch/src/collection/collection.model.js';
import { parseCollectionConfig } from '../dist/apps/batch/src/collection/collection.policy.js';
import { NaverNewsProvider } from '../dist/apps/batch/src/pipeline/naverNews.provider.js';

export async function collectionOrm() {
  const options = createDatabaseOptions();
  options.migrations.migrationsList.push(
    Migration20260920000000NewsDiscovery,
    Migration20260920000100NewsCollection,
  );
  return MikroORM.init(options);
}
async function main() {
  const command = process.argv[2] ?? 'run';
  if (!['run', 'migrate', 'plan'].includes(command)) throw new Error('UNKNOWN_COLLECTION_COMMAND');
  const config = parseCollectionConfig(
    JSON.parse(
      await readFile(process.env.NEWS_COLLECTION_CONFIG ?? 'config/news-collection.json', 'utf8'),
    ),
  );
  if (command === 'plan') {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  const source = process.argv[3];
  if (command === 'run' && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(source ?? ''))
    throw new Error('DISCOVERY_RUN_ID_REQUIRED');
  const orm = await collectionOrm();
  try {
    if (command === 'migrate') {
      await orm.migrator.up();
      console.log('Collection migrations applied');
      return;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const service = new CollectionService(
        new CollectionRepository(orm.em.fork()),
        new NaverNewsProvider(),
        new CollectionOpenAiModel(process.env.OPENAI_API_KEY ?? ''),
        (event) => console.log(JSON.stringify({ event: 'news.collection.progress', ...event })),
      );
      const run = await service.execute(source, config, new Date(), controller.signal);
      const directory = resolve(process.env.NEWS_COLLECTION_DATA_DIR ?? '.local/news-collection');
      await mkdir(directory, { recursive: true });
      const file = resolve(directory, `${run.discoveryRunId}-articles.json`);
      await writeFile(file, JSON.stringify(run.snapshot, null, 2));
      const counts = Object.fromEntries(
        ['SELECTED', 'DUPLICATE', 'INSUFFICIENT_ARTICLES', 'INSUFFICIENT_PUBLISHERS'].map((s) => [
          s,
          run.snapshot.results.filter((r) => r.status === s).length,
        ]),
      );
      console.log(
        JSON.stringify({
          runId: run.id,
          discoveryRunId: run.discoveryRunId,
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
        : 'COLLECTION_FAILED',
    );
    process.exitCode = 1;
  });
}
