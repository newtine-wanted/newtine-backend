import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Migration20260915000001IssuePersonalizationMetadata } from '@newtine/core/pipeline/migrations/Migration20260915000001IssuePersonalizationMetadata.js';

test('issue personalization metadata migration adds nullable producer-owned columns and entity integrity', () => {
  const migration = new Migration20260915000001IssuePersonalizationMetadata(
    undefined as never,
    undefined as never,
  );
  migration.up();
  const sql = migration.getQueries().join('\n');

  assert.match(sql, /add column if not exists main_topic text/);
  assert.match(sql, /add column if not exists representative_entity_id uuid/);
  assert.match(sql, /issues_main_topic_nonblank/);
  assert.match(sql, /issues_representative_entity_fk/);
  assert.match(sql, /references entities\(id\) on delete restrict/);
  assert.match(sql, /issues_representative_entity_idx/);
});

test('issue personalization metadata migration rejects automatic rollback', () => {
  const migration = new Migration20260915000001IssuePersonalizationMetadata(
    undefined as never,
    undefined as never,
  );

  assert.throws(() => migration.down(), /intentionally irreversible/);
});
