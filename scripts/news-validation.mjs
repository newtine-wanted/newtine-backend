import { Migration20260920000500NewsValidationTone } from '../dist/apps/batch/src/validation/validation-tone.migration.js';
import { Migration20260920000400NewsValidationMode } from '../dist/apps/batch/src/validation/validation-mode.migration.js';
/* global console, process, AbortController */
import 'reflect-metadata';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MikroORM } from '@mikro-orm/postgresql';
import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';
import { Migration20260920000000NewsDiscovery } from '../dist/apps/batch/src/discovery/discovery.migration.js';
import { Migration20260920000100NewsCollection } from '../dist/apps/batch/src/collection/collection.migration.js';
import { ValidationRepository } from '../dist/apps/batch/src/validation/validation.repository.js';
import { ValidationService } from '../dist/apps/batch/src/validation/validation.service.js';
import { ValidationOpenAiModel } from '../dist/apps/batch/src/validation/validation.model.js';
import { Migration20260920000200NewsGeneration } from '../dist/apps/batch/src/generation/generation.migration.js';

export async function validationOrm() {
  const options = createDatabaseOptions();
  options.migrations.migrationsList.push(
    Migration20260920000000NewsDiscovery,
    Migration20260920000100NewsCollection,
    Migration20260920000200NewsGeneration,
    Migration20260920000300NewsValidation,
    Migration20260920000400NewsValidationMode,
    Migration20260920000500NewsValidationTone,
  );
  return MikroORM.init(options);
}
import { Migration20260920000300NewsValidation } from '../dist/apps/batch/src/validation/validation.migration.js';
import { writeValidationReport } from './news-validation-report.mjs';

async function main() {
  const command = process.argv[2] ?? 'run';
  if (!['run', 'migrate'].includes(command)) throw new Error('UNKNOWN_VALIDATION_COMMAND');
  const config = JSON.parse(
    await readFile(process.env.NEWS_VALIDATION_CONFIG ?? 'config/news-validation.json', 'utf8'),
  );
  if (typeof config?.aiValidationEnabled !== 'boolean')
    throw new Error('INVALID_VALIDATION_CONFIG');
  const source = process.argv[3];
  if (command === 'run' && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(source ?? ''))
    throw new Error('GENERATION_RUN_ID_REQUIRED');
  const orm = await validationOrm();
  try {
    if (command === 'migrate') {
      await orm.migrator.up();
      console.log('Validation migrations applied');
      return;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const service = new ValidationService(
        new ValidationRepository(orm.em.fork()),
        config.aiValidationEnabled
          ? new ValidationOpenAiModel(process.env.OPENAI_API_KEY ?? '')
          : null,
        (event) => console.log(JSON.stringify({ event: 'news.validation.progress', ...event })),
        config.aiValidationEnabled,
      );
      const run = await service.execute(source, new Date(), controller.signal);
      const directory = resolve(process.env.NEWS_VALIDATION_DATA_DIR ?? '.local/news-validation');
      await mkdir(directory, { recursive: true });
      const file = resolve(
        directory,
        `${run.generationRunId}-${config.aiValidationEnabled ? 'tone' : 'rules-only'}-validated.json`,
      );
      await writeFile(file, JSON.stringify(run.snapshot, null, 2));
      await writeValidationReport(
        run,
        resolve(
          directory,
          `${run.generationRunId}-${config.aiValidationEnabled ? 'tone' : 'rules-only'}-report.md`,
        ),
      );
      const counts = Object.fromEntries(
        ['PASSED', 'HELD'].map((s) => [
          s,
          run.snapshot.results.filter((r) => r.status === s).length,
        ]),
      );
      console.log(
        JSON.stringify({
          runId: run.id,
          generationRunId: run.generationRunId,
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
        : 'VALIDATION_FAILED',
    );
    process.exitCode = 1;
  });
}
