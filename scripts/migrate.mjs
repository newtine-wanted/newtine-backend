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
  'user_interaction_events',
];

const REQUIRED_INTERACTION_COLUMNS = [
  ['id', 'uuid'],
  ['user_id', 'uuid'],
  ['issue_id', 'uuid'],
  ['event_type', 'text'],
  ['created_at', 'timestamptz'],
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

  const columnRows = await orm.em.getConnection().execute(`
    SELECT column_name, udt_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'user_interaction_events'
       AND column_name IN (${REQUIRED_INTERACTION_COLUMNS.map(([column]) => `'${column}'`).join(', ')})
  `);
  const columns = new Map(columnRows.map((row) => [row.column_name, row]));
  const invalidColumns = REQUIRED_INTERACTION_COLUMNS.filter(([column, udtName]) => {
    const row = columns.get(column);
    return row === undefined || row.udt_name !== udtName || row.is_nullable !== 'NO';
  }).map(([column, udtName]) => `${column} (${udtName} NOT NULL)`);
  if (invalidColumns.length > 0) {
    throw new Error(
      `Base schema preflight failed for user_interaction_events; expected columns: ${invalidColumns.join(', ')}`,
    );
  }

  const indexRows = await orm.em.getConnection().execute(`
    SELECT index_record.relname AS index_name,
           am.amname,
           index_state.indisvalid,
           index_state.indisready,
           index_state.indpred IS NULL AS is_unpartial,
           index_state.indnkeyatts,
           key.ordinality,
           attribute.attname,
           ((index_state.indoption::int2[])[key.ordinality - 1] & 1) = 1 AS is_descending
      FROM pg_index AS index_state
      JOIN pg_class AS table_record ON table_record.oid = index_state.indrelid
      JOIN pg_class AS index_record ON index_record.oid = index_state.indexrelid
      JOIN pg_namespace AS namespace_record ON namespace_record.oid = table_record.relnamespace
      JOIN pg_am AS am ON am.oid = index_record.relam
      CROSS JOIN LATERAL unnest(index_state.indkey::int2[]) WITH ORDINALITY AS key(attnum, ordinality)
      LEFT JOIN pg_attribute AS attribute
        ON attribute.attrelid = table_record.oid
       AND attribute.attnum = key.attnum
     WHERE namespace_record.nspname = current_schema()
       AND table_record.relname = 'user_interaction_events'
       AND key.ordinality <= index_state.indnkeyatts
     ORDER BY index_record.relname, key.ordinality
  `);
  const indexes = new Map();
  for (const row of indexRows) {
    const index = indexes.get(row.index_name) ?? {
      accessMethod: row.amname,
      valid: row.indisvalid,
      ready: row.indisready,
      unpartial: row.is_unpartial,
      keyCount: Number(row.indnkeyatts),
      columns: [],
      descending: [],
    };
    index.columns.push(row.attname);
    index.descending.push(row.is_descending);
    indexes.set(row.index_name, index);
  }
  const hasInteractionIndex = [...indexes.values()].some(
    (index) =>
      index.accessMethod === 'btree' &&
      index.valid === true &&
      index.ready === true &&
      index.unpartial === true &&
      index.keyCount === 4 &&
      index.columns.length === 4 &&
      index.columns.every(
        (column, position) => column === ['user_id', 'issue_id', 'created_at', 'id'][position],
      ) &&
      index.descending.every(
        (descending, position) => descending === [false, false, true, true][position],
      ),
  );
  if (!hasInteractionIndex) {
    throw new Error(
      'Base schema preflight failed for user_interaction_events; a valid non-partial btree index on (user_id, issue_id, created_at DESC, id DESC) is required',
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
