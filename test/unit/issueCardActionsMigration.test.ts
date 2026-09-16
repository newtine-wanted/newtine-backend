import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { Migration20260916000000IssueCardActions } from '@newtine/core/interest/migrations/Migration20260916000000IssueCardActions.js';

test('issue card actions migration creates ordered events and bounded ledgers', () => {
  const migration = new Migration20260916000000IssueCardActions(
    undefined as never,
    undefined as never,
  );
  migration.up();
  const sql = migration.getQueries().join('\n');

  assert.match(sql, /requires an explicit transition for existing interaction history/);
  assert.match(sql, /user_interaction_events_accepted_order_seq/);
  assert.match(sql, /user_interaction_events_user_issue_order_idx/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_issue_contributions/i);
  assert.match(sql, /user_issue_contributions_action_score_check/);
  assert.match(sql, /user_issue_contributions_dwell_score_check/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS issue_detail_views/i);
  assert.match(sql, /issue_detail_views_active_ms_check/);
  assert.match(sql, /issue_detail_views_expiry_check/);
});

test('issue card actions migration refuses an automatic rollback', () => {
  const migration = new Migration20260916000000IssueCardActions(
    undefined as never,
    undefined as never,
  );

  assert.throws(() => migration.down(), /append-only/);
});
