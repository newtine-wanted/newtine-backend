/* global process, console */
import { existsSync } from 'node:fs';
import { collectionOrm } from './news-collection.mjs';
import { NewsPipelinePreparation } from '../dist/apps/batch/src/preparation/preparation.service.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: node scripts/news-pipeline-prepare.mjs [terms|search|all]\nApply 001_schema.sql first. Existing application data is read only.',
    );
    return;
  }
  const mode = args[0] ?? 'all';
  if (args.length > 1 || !['terms', 'search', 'all'].includes(mode))
    throw new Error('INVALID_PREPARATION_ARGUMENTS');
  if (existsSync('.env')) process.loadEnvFile('.env');
  const orm = await collectionOrm();
  try {
    const service = new NewsPipelinePreparation(orm.em.fork());
    const terms = mode === 'search' ? undefined : await service.terms();
    if (mode !== 'terms') await service.search();
    console.log(JSON.stringify({ mode, terms, searchRefreshed: mode !== 'terms' }));
  } finally {
    await orm.close(true);
  }
}
main().catch((error) => {
  console.error(
    /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'PREPARATION_FAILED',
  );
  process.exitCode = 1;
});
