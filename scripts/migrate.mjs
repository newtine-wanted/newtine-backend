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

const REQUIRED_INTERACTION_COLUMNS = [
  ['id', 'uuid', 'NO'],
  ['user_id', 'uuid', 'NO'],
  ['issue_id', 'uuid', 'NO'],
  ['session_id', 'uuid', 'NO'],
  ['event_type', 'text', 'NO'],
  ['dwell_time', 'int4', 'YES'],
  ['previous_action', 'text', 'YES'],
  ['created_at', 'timestamptz', 'NO'],
];

const REQUIRED_INTERACTION_CONSTRAINTS = [
  { name: 'user_interaction_events_pkey', type: 'p', columns: 'id' },
  {
    name: 'user_interaction_events_user_fk',
    type: 'f',
    columns: 'user_id',
    referencedTable: 'users',
    referencedColumns: 'id',
    onDelete: 'c',
  },
  {
    name: 'user_interaction_events_issue_fk',
    type: 'f',
    columns: 'issue_id',
    referencedTable: 'issues',
    referencedColumns: 'id',
    onDelete: 'r',
  },
  {
    name: 'user_interaction_events_event_type_check',
    type: 'c',
    columns: 'event_type',
    definition: normalizeSqlDefinition(
      "CHECK ((event_type = ANY (ARRAY['LIKE'::text, 'SKIP'::text, 'PASS'::text])))",
    ),
  },
  {
    name: 'user_interaction_events_dwell_time_check',
    type: 'c',
    columns: 'dwell_time',
    definition: normalizeSqlDefinition('CHECK (((dwell_time IS NULL) OR (dwell_time >= 0)))'),
  },
  {
    name: 'user_interaction_events_previous_action_check',
    type: 'c',
    columns: 'previous_action',
    definition: normalizeSqlDefinition(
      "CHECK (((previous_action IS NULL) OR (previous_action = ANY (ARRAY['LIKE'::text, 'SKIP'::text, 'PASS'::text]))))",
    ),
  },
];

function normalizeSqlDefinition(value) {
  const source = String(value ?? '');
  let normalized = '';
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") {
      normalized += character;
      if (inString && source[index + 1] === "'") {
        normalized += source[index + 1];
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (!inString && character === '"') continue;
    normalized += inString ? character : character.toLowerCase();
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

function execute(orm, sql, transaction) {
  return orm.em.getConnection().execute(sql, undefined, 'all', transaction);
}

async function assertBaseSchema(orm) {
  const rows = await execute(
    orm,
    `
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name IN (${REQUIRED_BASE_TABLES.map((table) => `'${table}'`).join(', ')})
  `,
  );
  const present = new Set(rows.map((row) => row.table_name));
  const missing = REQUIRED_BASE_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(
      `Base schema preflight failed. Apply the external base migration first; missing tables: ${missing.join(', ')}`,
    );
  }
}

async function assertInteractionSchema(orm, transaction) {
  const columnRows = await execute(
    orm,
    `
    SELECT column_name, udt_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'user_interaction_events'
  `,
    transaction,
  );
  const columns = new Map(columnRows.map((row) => [row.column_name, row]));
  const expectedColumnNames = new Set(REQUIRED_INTERACTION_COLUMNS.map(([column]) => column));
  const invalidColumns = REQUIRED_INTERACTION_COLUMNS.filter(([column, udtName, nullability]) => {
    const row = columns.get(column);
    return row === undefined || row.udt_name !== udtName || row.is_nullable !== nullability;
  }).map(
    ([column, udtName, nullability]) =>
      `${column} (${udtName} ${nullability === 'NO' ? 'NOT NULL' : 'NULLABLE'})`,
  );
  const unexpectedRequiredColumns = columnRows
    .filter((row) => !expectedColumnNames.has(row.column_name) && row.is_nullable === 'NO')
    .map((row) => `${row.column_name} (${row.udt_name} NOT NULL)`);
  if (invalidColumns.length > 0 || unexpectedRequiredColumns.length > 0) {
    const columnErrors = [];
    if (invalidColumns.length > 0)
      columnErrors.push(`expected columns: ${invalidColumns.join(', ')}`);
    if (unexpectedRequiredColumns.length > 0) {
      columnErrors.push(`unexpected required columns: ${unexpectedRequiredColumns.join(', ')}`);
    }
    throw new Error(
      `Application schema verification failed for user_interaction_events; ${columnErrors.join('; ')}`,
    );
  }

  const constraintRows = await execute(
    orm,
    `
    SELECT constraint_record.conname AS constraint_name,
           constraint_record.contype AS constraint_type,
           constraint_record.convalidated AS is_validated,
           pg_get_constraintdef(constraint_record.oid) AS definition,
           COALESCE((
             SELECT string_agg(local_attribute.attname, ',' ORDER BY key.ordinality)
               FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key(attnum, ordinality)
               JOIN pg_attribute AS local_attribute
                 ON local_attribute.attrelid = constraint_record.conrelid
                AND local_attribute.attnum = key.attnum
           ), '') AS columns,
           COALESCE((
             SELECT string_agg(referenced_attribute.attname, ',' ORDER BY key.ordinality)
               FROM unnest(constraint_record.confkey) WITH ORDINALITY AS key(attnum, ordinality)
               JOIN pg_attribute AS referenced_attribute
                 ON referenced_attribute.attrelid = constraint_record.confrelid
                AND referenced_attribute.attnum = key.attnum
           ), '') AS referenced_columns,
           referenced_table.relname AS referenced_table,
           referenced_namespace.nspname AS referenced_schema,
           constraint_record.confdeltype AS on_delete,
           current_schema() AS schema_name
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace_record ON namespace_record.oid = table_record.relnamespace
      LEFT JOIN pg_class AS referenced_table ON referenced_table.oid = constraint_record.confrelid
      LEFT JOIN pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced_table.relnamespace
     WHERE namespace_record.nspname = current_schema()
       AND table_record.relname = 'user_interaction_events'
       AND constraint_record.contype <> 'n'
  `,
    transaction,
  );
  const constraints = new Map(
    constraintRows.map((row) => [
      row.constraint_name,
      {
        type: row.constraint_type,
        validated: row.is_validated,
        definition: normalizeSqlDefinition(row.definition),
        columns: row.columns,
        referencedColumns: row.referenced_columns,
        referencedTable: row.referenced_table,
        referencedSchema: row.referenced_schema,
        schema: row.schema_name,
        onDelete: row.on_delete,
      },
    ]),
  );
  const invalidConstraints = REQUIRED_INTERACTION_CONSTRAINTS.filter((expected) => {
    const actual = constraints.get(expected.name);
    if (
      actual === undefined ||
      actual.type !== expected.type ||
      actual.validated !== true ||
      actual.columns !== expected.columns
    ) {
      return true;
    }
    if (expected.type === 'f') {
      return (
        actual.referencedTable !== expected.referencedTable ||
        actual.referencedColumns !== expected.referencedColumns ||
        actual.referencedSchema !== actual.schema ||
        actual.onDelete !== expected.onDelete
      );
    }
    if (expected.type === 'c') {
      return actual.definition !== expected.definition;
    }
    return false;
  }).map((expected) => expected.name);
  const expectedConstraintNames = new Set(REQUIRED_INTERACTION_CONSTRAINTS.map(({ name }) => name));
  const unexpectedConstraints = constraintRows
    .filter((row) => !expectedConstraintNames.has(row.constraint_name))
    .map((row) => `${row.constraint_name} (${row.constraint_type})`);
  if (invalidConstraints.length > 0 || unexpectedConstraints.length > 0) {
    const constraintErrors = [];
    if (invalidConstraints.length > 0) {
      constraintErrors.push(`invalid constraints: ${invalidConstraints.join(', ')}`);
    }
    if (unexpectedConstraints.length > 0) {
      constraintErrors.push(`unexpected constraints: ${unexpectedConstraints.join(', ')}`);
    }
    throw new Error(
      `Application schema verification failed for user_interaction_events; ${constraintErrors.join('; ')}`,
    );
  }

  const indexRows = await execute(
    orm,
    `
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
  `,
    transaction,
  );
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
  const hasIndex = (columns, descending) =>
    [...indexes.values()].some(
      (index) =>
        index.accessMethod === 'btree' &&
        index.valid === true &&
        index.ready === true &&
        index.unpartial === true &&
        index.keyCount === columns.length &&
        index.columns.length === columns.length &&
        index.columns.every((column, position) => column === columns[position]) &&
        index.descending.every((isDescending, position) => isDescending === descending[position]),
    );
  const hasInteractionIndex = hasIndex(
    ['user_id', 'issue_id', 'created_at', 'id'],
    [false, false, true, true],
  );
  if (!hasInteractionIndex) {
    throw new Error(
      'Application schema verification failed for user_interaction_events; a valid non-partial btree index on (user_id, issue_id, created_at DESC, id DESC) is required',
    );
  }
  if (!hasIndex(['user_id', 'created_at'], [false, true])) {
    throw new Error(
      'Application schema verification failed for user_interaction_events; a valid non-partial btree index on (user_id, created_at DESC) is required',
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
      await orm.em.getConnection().transactional(async (transaction) => {
        await orm.migrator.up({ transaction });
        await assertInteractionSchema(orm, transaction);
      });
    } else {
      await orm.migrator.down();
    }
  } finally {
    await orm.close(true);
  }
}
