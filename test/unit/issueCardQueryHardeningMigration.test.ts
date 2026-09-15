import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Migration20260915000003IssueCardQueryHardening } from '@newtine/core/pipeline/migrations/Migration20260915000003IssueCardQueryHardening.js';

test('issue card hardening migration closes summary and score contracts', () => {
  const migration = new Migration20260915000003IssueCardQueryHardening(
    undefined as never,
    undefined as never,
  );
  migration.up();
  const sql = migration.getQueries().join('\n');

  assert.match(sql, /create or replace function issue_card_summary_lines_valid\(value jsonb\)/);
  assert.match(sql, /jsonb_typeof\(value\) <> 'array'/);
  assert.match(sql, /jsonb_typeof\(line\) <> 'string'/);
  assert.match(sql, /issue_details_summary_lines_contract_check/);
  assert.match(sql, /issues_freshness_score_range_check/);
  assert.match(sql, /issues_importance_score_range_check/);
  assert.match(sql, /validate constraint issue_details_summary_lines_contract_check/);
});

test('issue card hardening migration rejects automatic rollback', () => {
  const migration = new Migration20260915000003IssueCardQueryHardening(
    undefined as never,
    undefined as never,
  );

  assert.throws(() => migration.down(), /intentionally irreversible/);
});
