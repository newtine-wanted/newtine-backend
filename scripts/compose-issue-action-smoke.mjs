/* global URL, console, fetch, process */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';

import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';

const baseUrl = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:3000');
const smokeEnvironment = process.env.SMOKE_DB_ENVIRONMENT ?? 'issue-card-query-smoke';
const password = 'correct-horse-battery-staple';
const issueIds = [];
const userIds = [];
const rollbackTriggerName = 'issue_card_action_smoke_fail';
const rollbackFunctionName = 'issue_card_action_smoke_fail_fn';
let orm;

function databaseEnv() {
  const env = {
    NODE_ENV: 'test',
    DB_HOST: process.env.SMOKE_DB_HOST,
    DB_PORT: process.env.SMOKE_DB_PORT,
    DB_NAME: process.env.SMOKE_DB_NAME,
    DB_USER: process.env.SMOKE_DB_USER,
    DB_PASSWORD: process.env.SMOKE_DB_PASSWORD,
  };
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    if (env[key] === undefined || env[key].trim() === '') {
      throw new Error(`SMOKE_DB_${key.slice(3)} is required`);
    }
  }
  if (env.DB_HOST !== '127.0.0.1' && env.DB_HOST !== '::1') {
    throw new Error('SMOKE_DB_HOST must be a loopback address');
  }
  return env;
}

async function sql(statement, params = [], mode = 'run') {
  return orm.em.getConnection().execute(statement, params, mode);
}

async function request(path, init = {}) {
  const publicPath = path === '/api' || path.startsWith('/api/') ? path : `/api${path}`;
  const response = await fetch(new URL(publicPath, baseUrl), init);
  const body = await response.text();
  return { response, body, json: body === '' ? null : JSON.parse(body) };
}

async function signup() {
  const result = await request('/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `issue-action-${randomUUID()}@example.com`, password }),
  });
  assert.equal(result.response.status, 201, result.body);
  assert.ok(result.json?.user?.id);
  userIds.push(result.json.user.id);
  return result.json.accessToken;
}

async function action(token, method, path, body) {
  return request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function assertDisposableDatabase() {
  const rows = await sql(
    'SELECT environment FROM smoke_environment_marker WHERE environment = ?',
    [smokeEnvironment],
    'all',
  );
  assert.equal(
    rows.length,
    1,
    'SMOKE_DB_* must identify the disposable issue-card-query-smoke PostgreSQL database',
  );
}

async function createIssue(title) {
  const issueId = randomUUID();
  issueIds.push(issueId);
  await sql(
    `INSERT INTO issues
      (id, category_code, title, publication_status, published_at, created_at, updated_at,
       event_at, sub_category, freshness_score, importance_score, main_topic,
       representative_entity_id)
     VALUES (?, 'housing', ?, 'PUBLISHED', clock_timestamp(), clock_timestamp(),
             clock_timestamp(), clock_timestamp(), 'smoke', 0.8, 0.8, 'issue-action-smoke', NULL)`,
    [issueId, title],
  );
  return issueId;
}

async function assertActionEndpoints(tokenA, tokenB, userA, issueId) {
  const eventId = randomUUID();
  const sessionId = randomUUID();
  const concurrent = await Promise.all([
    action(tokenA, 'POST', `/issues/${issueId}/interactions`, {
      eventId,
      sessionId,
      action: 'LIKE',
    }),
    action(tokenB, 'POST', `/issues/${issueId}/interactions`, {
      eventId,
      sessionId,
      action: 'LIKE',
    }),
  ]);
  assert.deepEqual(concurrent.map(({ response }) => response.status).sort(), [200, 409]);

  const winnerToken = concurrent[0].response.status === 200 ? tokenA : tokenB;
  const replay = await action(winnerToken, 'POST', `/issues/${issueId}/interactions`, {
    eventId,
    sessionId,
    action: 'LIKE',
  });
  assert.equal(replay.response.status, 200, replay.body);
  assert.equal(replay.json.acceptedAction, 'LIKE');

  const liked = await request('/me/liked-issues', {
    headers: { authorization: `Bearer ${winnerToken}` },
  });
  assert.equal(liked.response.status, 200, liked.body);
  assert.equal(
    liked.json.items.some((item) => item.issueId === issueId),
    true,
  );

  const competingViewId = randomUUID();
  const competingViewSessionId = randomUUID();
  const concurrentViews = await Promise.all([
    action(tokenA, 'PUT', `/issues/${issueId}/detail-views/${competingViewId}`, {
      sessionId: competingViewSessionId,
    }),
    action(tokenB, 'PUT', `/issues/${issueId}/detail-views/${competingViewId}`, {
      sessionId: competingViewSessionId,
    }),
  ]);
  assert.deepEqual(concurrentViews.map(({ response }) => response.status).sort(), [201, 409]);

  const viewA = randomUUID();
  const viewB = randomUUID();
  const expiredView = randomUUID();
  const viewSessionA = randomUUID();
  const startA = await action(tokenA, 'PUT', `/issues/${issueId}/detail-views/${viewA}`, {
    sessionId: viewSessionA,
  });
  assert.equal(startA.response.status, 201, startA.body);
  const startReplay = await action(tokenA, 'PUT', `/issues/${issueId}/detail-views/${viewA}`, {
    sessionId: viewSessionA,
  });
  assert.equal(startReplay.response.status, 200, startReplay.body);
  assert.deepEqual(startReplay.json, startA.json);
  await sql(
    "UPDATE issue_detail_views SET started_at = clock_timestamp() - interval '1 minute' WHERE view_id = ?",
    [viewA],
  );
  const progressA = await action(
    tokenA,
    'PUT',
    `/issues/${issueId}/detail-views/${viewA}/progress`,
    { activeMilliseconds: 15_000 },
  );
  assert.equal(progressA.response.status, 200, progressA.body);
  assert.equal(progressA.json.totalCreditedMilliseconds, 15_000);
  assert.equal(progressA.json.dwellScore, 0.5);

  const foreignProgress = await action(
    tokenB,
    'PUT',
    `/issues/${issueId}/detail-views/${viewA}/progress`,
    { activeMilliseconds: 15_000 },
  );
  assert.equal(foreignProgress.response.status, 404, foreignProgress.body);

  const startB = await action(tokenA, 'PUT', `/issues/${issueId}/detail-views/${viewB}`, {
    sessionId: randomUUID(),
  });
  assert.equal(startB.response.status, 201, startB.body);
  await sql(
    "UPDATE issue_detail_views SET started_at = clock_timestamp() - interval '1 minute' WHERE view_id = ?",
    [viewB],
  );
  const progressB = await action(
    tokenA,
    'PUT',
    `/issues/${issueId}/detail-views/${viewB}/progress`,
    { activeMilliseconds: 20_000 },
  );
  assert.equal(progressB.response.status, 200, progressB.body);
  assert.equal(progressB.json.totalCreditedMilliseconds, 30_000);
  assert.equal(progressB.json.dwellScore, 1);

  const contribution = await sql(
    'SELECT credited_dwell_ms, dwell_score FROM user_issue_contributions WHERE user_id = ? AND issue_id = ?',
    [userA, issueId],
    'all',
  );
  assert.deepEqual(
    contribution.map((row) => ({
      credited: Number(row.credited_dwell_ms),
      score: Number(row.dwell_score),
    })),
    [{ credited: 30_000, score: 1 }],
  );

  const startExpired = await action(
    tokenA,
    'PUT',
    `/issues/${issueId}/detail-views/${expiredView}`,
    { sessionId: randomUUID() },
  );
  assert.equal(startExpired.response.status, 201, startExpired.body);
  await sql(
    "UPDATE issue_detail_views SET started_at = clock_timestamp() - interval '2 minutes', expires_at = clock_timestamp() - interval '1 minute' WHERE view_id = ?",
    [expiredView],
  );
  const expiredProgress = await action(
    tokenA,
    'PUT',
    `/issues/${issueId}/detail-views/${expiredView}/progress`,
    { activeMilliseconds: 1_000 },
  );
  assert.equal(expiredProgress.response.status, 410, expiredProgress.body);
}

async function installRollbackTrigger() {
  await sql(
    `CREATE OR REPLACE FUNCTION ${rollbackFunctionName}()
     RETURNS trigger
     LANGUAGE plpgsql
     AS $$
     BEGIN
       RAISE EXCEPTION 'issue card action smoke rollback';
     END;
     $$`,
  );
  await sql(`DROP TRIGGER IF EXISTS ${rollbackTriggerName} ON user_issue_contributions`);
  await sql(
    `CREATE TRIGGER ${rollbackTriggerName}
     AFTER INSERT OR UPDATE ON user_issue_contributions
     FOR EACH ROW EXECUTE FUNCTION ${rollbackFunctionName}()`,
  );
}

async function assertAtomicRollback(token, userId, issueId) {
  const beforePreferences = await sql(
    'SELECT category_code, weight FROM user_category_preferences WHERE user_id = ? AND category_code = ?',
    [userId, 'housing'],
    'all',
  );
  const result = await action(token, 'POST', `/issues/${issueId}/interactions`, {
    eventId: randomUUID(),
    sessionId: randomUUID(),
    action: 'LIKE',
  });
  assert.equal(result.response.status, 503, result.body);

  const events = await sql(
    'SELECT id FROM user_interaction_events WHERE user_id = ? AND issue_id = ?',
    [userId, issueId],
    'all',
  );
  const contributions = await sql(
    'SELECT user_id FROM user_issue_contributions WHERE user_id = ? AND issue_id = ?',
    [userId, issueId],
    'all',
  );
  const afterPreferences = await sql(
    'SELECT category_code, weight FROM user_category_preferences WHERE user_id = ? AND category_code = ?',
    [userId, 'housing'],
    'all',
  );
  assert.equal(events.length, 0);
  assert.equal(contributions.length, 0);
  assert.deepEqual(afterPreferences, beforePreferences);
}

async function cleanup() {
  if (orm === undefined) return;
  await sql(`DROP TRIGGER IF EXISTS ${rollbackTriggerName} ON user_issue_contributions`);
  await sql(`DROP FUNCTION IF EXISTS ${rollbackFunctionName}()`);
  for (const issueId of issueIds) {
    await sql('DELETE FROM issue_detail_views WHERE issue_id = ?', [issueId]);
    await sql('DELETE FROM user_issue_contributions WHERE issue_id = ?', [issueId]);
    await sql('DELETE FROM user_interaction_events WHERE issue_id = ?', [issueId]);
    await sql('DELETE FROM issues WHERE id = ?', [issueId]);
  }
  for (const userId of userIds) await sql('DELETE FROM users WHERE id = ?', [userId]);
}

try {
  orm = await MikroORM.init(createDatabaseOptions(databaseEnv()));
  await assertDisposableDatabase();
  const tokenA = await signup();
  const tokenB = await signup();
  const actionIssueId = await createIssue('Issue card action smoke');
  const rollbackIssueId = await createIssue('Issue card action rollback smoke');

  await assertActionEndpoints(tokenA, tokenB, userIds[0], actionIssueId);
  await installRollbackTrigger();
  await assertAtomicRollback(tokenA, userIds[0], rollbackIssueId);

  console.log(
    'Compose issue action smoke passed: acceptance order, idempotent conflicts, cumulative dwell, ownership, expiry, and transaction rollback',
  );
} finally {
  try {
    await cleanup();
  } finally {
    if (orm !== undefined) await orm.close(true);
  }
}
