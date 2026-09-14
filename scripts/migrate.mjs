/* global console, process */

import { MikroORM } from '@mikro-orm/postgresql';

import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';

const command = process.argv[2] ?? 'up';
const REQUIRED_BASE_TABLES = [
  'users',
  'entities',
  'issue_categories',
  'user_category_preferences',
  'user_entity_preferences',
];

async function assertBaseSchema(orm) {
  const rows = await orm.em.getConnection().execute(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name IN (${REQUIRED_BASE_TABLES.map((table) => `'${table}'`).join(', ')})
  `);
  const present = new Set(rows.map((row) => row.table_name));
  const missing = REQUIRED_BASE_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(
      `Base schema preflight failed. Apply the external base migration first; missing tables: ${missing.join(', ')}`,
    );
  }
}

if (command !== 'up' && command !== 'down') {
  console.error(`Unknown migration command: ${command}. Use "up" or "down".`);
  process.exitCode = 2;
} else {
  const orm = await MikroORM.init(createDatabaseOptions());
  try {
    if (command === 'up') {
      await assertBaseSchema(orm);
      await orm.migrator.up();
    } else {
      await orm.migrator.down();
    }
  } finally {
    await orm.close(true);
  }
}
