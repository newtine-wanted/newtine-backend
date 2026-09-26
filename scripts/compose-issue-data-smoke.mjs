/* global URL, console, fetch, process */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';

import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';
import { IssueCardQueryRepository } from '../dist/apps/api/src/issue/repository/issueCardQuery.repository.js';

const baseUrl = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:3000');
const smokeEnvironment = 'issue-card-query-smoke';
const email = `compose-issue-data-${Date.now()}@example.com`;
const password = 'correct-horse-battery-staple';
const issueIds = [];
const articleIds = [];
const publisherIds = [];
const guestTokenHashes = new Set();
const expectedLatestInteractions = new Map();
let orm;
let userId;

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

async function request(path, init = {}) {
  const publicPath = path === '/api' || path.startsWith('/api/') ? path : `/api${path}`;
  const response = await fetch(new URL(publicPath, baseUrl), init);
  return { response, body: await response.text() };
}

function parseJson(result) {
  assert.notEqual(result.body, '', `expected JSON response for ${result.response.url}`);
  return JSON.parse(result.body);
}

function guestCookie(result) {
  const cookies =
    typeof result.response.headers.getSetCookie === 'function'
      ? result.response.headers.getSetCookie()
      : [result.response.headers.get('set-cookie') ?? ''];
  const value = cookies.find((cookie) => cookie.startsWith('newtine_feed_guest='));
  assert.ok(value, `guest feed cookie missing for ${result.response.url}`);
  const encodedToken = value.slice('newtine_feed_guest='.length).split(';', 1)[0];
  const token = decodeURIComponent(encodedToken);
  assert.match(token, /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  guestTokenHashes.add(createHash('sha256').update(token, 'utf8').digest('hex'));
  assert.match(value, /Path=\/api\/feed/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Lax/);
  return `newtine_feed_guest=${token}`;
}

function assertFeedPage(result, expectedStatus = 200) {
  assert.equal(result.response.status, expectedStatus);
  const body = parseJson(result);
  if (expectedStatus !== 200) return body;
  assert.match(result.response.headers.get('cache-control') ?? '', /private/);
  assert.match(result.response.headers.get('cache-control') ?? '', /no-store/);
  assert.ok(Array.isArray(body.items));
  assert.equal(Object.hasOwn(body, 'sessionId'), false);
  assert.equal(Object.hasOwn(body, 'batchNo'), false);
  assert.equal(Object.hasOwn(body, 'nextBatchNo'), false);
  assert.ok(body.nextCursor === null || typeof body.nextCursor === 'string');
  return body;
}

async function execute(sql, params = [], mode = 'run') {
  return orm.em.getConnection().execute(sql, params, mode);
}

async function assertDisposableDatabase() {
  const rows = await execute(
    'SELECT environment FROM smoke_environment_marker WHERE environment = ?',
    [smokeEnvironment],
    'all',
  );
  if (rows.length !== 1) {
    throw new Error(
      'SMOKE_DB_* must identify the disposable issue-card-query-smoke PostgreSQL database',
    );
  }
}

async function seedIssueData() {
  await execute(
    "UPDATE users SET age_group = 'AGE_19_34', onboarding_status = 'COMPLETED' WHERE id = ?",
    [userId],
  );
  await execute(
    'INSERT INTO user_category_preferences (user_category_preferences_id, user_id, category_code, weight) VALUES (?, ?, ?, ?)',
    [randomUUID(), userId, 'housing', 1],
  );

  const publisherId = randomUUID();
  const articleId = randomUUID();
  publisherIds.push(publisherId);
  articleIds.push(articleId);
  await execute('INSERT INTO publishers (id, name, homepage_url) VALUES (?, ?, ?)', [
    publisherId,
    'Issue card smoke publisher',
    'https://example.com',
  ]);
  await execute(
    'INSERT INTO articles (id, publisher_id, title, description, article_url, publisher_name, published_at, source_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      articleId,
      publisherId,
      'Issue card smoke article',
      'fixture',
      `https://example.com/issue-card-smoke/${articleId}`,
      'Issue card smoke publisher',
      '2026-01-01T00:00:00.000Z',
      'AVAILABLE',
    ],
  );

  for (let index = 0; index < 14; index += 1) {
    const issueId = randomUUID();
    issueIds.push(issueId);
    const categoryCode = index % 3 === 0 ? 'housing' : index % 3 === 1 ? 'labor' : 'finance';
    await execute(
      'INSERT INTO issues (id, category_code, title, publication_status, published_at, created_at, updated_at, event_at, sub_category, freshness_score, importance_score, main_topic, representative_entity_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        issueId,
        categoryCode,
        `Issue card smoke ${index}`,
        'PUBLISHED',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        'smoke',
        0.8,
        0.8,
        `smoke-topic-${index}`,
        null,
      ],
    );
    await execute(
      'INSERT INTO issue_details (id, issue_id, integrated_summary, summary_lines, viewpoints, glossary) VALUES (?, ?, ?, ?, ?, ?)',
      [
        randomUUID(),
        issueId,
        `Issue card smoke summary ${index}`,
        JSON.stringify([`사실 ${index}`, `쟁점 ${index}`, `영향 ${index}`]),
        JSON.stringify(index === 0 ? [{ statement: '검증된 관점', articleIds: [articleId] }] : []),
        JSON.stringify([]),
      ],
    );
    if (index === 0) {
      await execute(
        'INSERT INTO issue_impacts (id, issue_id, target_type, target_value, description, article_ids) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), issueId, 'AGE_GROUP', 'AGE_19_34', '회원 맞춤 영향', JSON.stringify([])],
      );
      await execute(
        'INSERT INTO issue_articles (issue_id, article_id, sort_order) VALUES (?, ?, ?)',
        [issueId, articleId, 1],
      );
    }
  }

  const [lowerInteractionId, higherInteractionId] = [randomUUID(), randomUUID()].sort();
  const interactionTimestamp = '2026-01-15T00:00:00.000Z';
  for (const [id, eventType] of [
    [lowerInteractionId, 'LIKE'],
    [higherInteractionId, 'SKIP'],
  ]) {
    await execute(
      'INSERT INTO user_interaction_events (id, user_id, issue_id, session_id, event_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, issueIds[0], randomUUID(), eventType, interactionTimestamp],
    );
  }
  const secondInteractionId = randomUUID();
  await execute(
    'INSERT INTO user_interaction_events (id, user_id, issue_id, session_id, event_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [secondInteractionId, userId, issueIds[1], randomUUID(), 'LIKE', interactionTimestamp],
  );
  await execute(
    'INSERT INTO issue_relations (from_issue_id, to_issue_id, relation_type, reason, evidence_refs, verified_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      issueIds[1],
      issueIds[2],
      'FOLLOW_UP',
      'smoke relation',
      JSON.stringify([]),
      interactionTimestamp,
    ],
  );
  expectedLatestInteractions.set(issueIds[0], { id: higherInteractionId, eventType: 'SKIP' });
  expectedLatestInteractions.set(issueIds[1], { id: secondInteractionId, eventType: 'LIKE' });

  const contractRows = await execute(
    'SELECT issue_card_summary_lines_valid(?::jsonb) AS valid, issue_card_summary_lines_valid(?::jsonb) AS invalid',
    [JSON.stringify(['a', 'b', 'c']), JSON.stringify(['a', 2, 'c'])],
    'all',
  );
  assert.equal(contractRows[0]?.valid, true);
  assert.equal(contractRows[0]?.invalid, false);
}

async function assertLatestInteractionQuery() {
  const repository = new IssueCardQueryRepository(orm.em.fork());
  const rows = await repository.findLatestInteractions(userId);
  const expected = [...expectedLatestInteractions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([issueId, interaction]) => ({ issueId, ...interaction }));
  assert.deepEqual(
    rows.map(({ issueId, id, eventType }) => ({ issueId, id, eventType })),
    expected,
  );
}

async function expireMemberSession() {
  const rows = await execute(
    'SELECT id FROM feed_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId],
    'all',
  );
  assert.equal(rows.length, 1);
  await execute("UPDATE feed_sessions SET expires_at = now() - interval '1 second' WHERE id = ?", [
    rows[0].id,
  ]);
}

async function cleanup() {
  const guestHashes = [...guestTokenHashes];
  if (userId !== undefined || guestHashes.length > 0) {
    const ownerClauses = [];
    const ownerParams = [];
    if (userId !== undefined) {
      ownerClauses.push('user_id = ?');
      ownerParams.push(userId);
    }
    if (guestHashes.length > 0) {
      ownerClauses.push(`guest_token_hash IN (${guestHashes.map(() => '?').join(', ')})`);
      ownerParams.push(...guestHashes);
    }
    await execute(`DELETE FROM feed_sessions WHERE ${ownerClauses.join(' OR ')}`, ownerParams);
  }
  for (const issueId of issueIds) {
    await execute('DELETE FROM issue_detail_views WHERE issue_id = ?', [issueId]);
    await execute('DELETE FROM user_issue_contributions WHERE issue_id = ?', [issueId]);
    await execute('DELETE FROM user_interaction_events WHERE issue_id = ?', [issueId]);
    await execute('DELETE FROM issue_articles WHERE issue_id = ?', [issueId]);
    await execute('DELETE FROM issue_impacts WHERE issue_id = ?', [issueId]);
    await execute('DELETE FROM issue_entities WHERE issue_id = ?', [issueId]);
    await execute('DELETE FROM issue_relations WHERE from_issue_id = ? OR to_issue_id = ?', [
      issueId,
      issueId,
    ]);
    await execute('DELETE FROM issue_details WHERE issue_id = ?', [issueId]);
    await execute('DELETE FROM issues WHERE id = ?', [issueId]);
  }
  for (const articleId of articleIds) {
    await execute('DELETE FROM articles WHERE id = ?', [articleId]);
  }
  for (const publisherId of publisherIds) {
    await execute('DELETE FROM publishers WHERE id = ?', [publisherId]);
  }
  if (userId !== undefined) {
    await execute('DELETE FROM users WHERE id = ?', [userId]);
  }
}

try {
  orm = await MikroORM.init(createDatabaseOptions(databaseEnv()));
  await assertDisposableDatabase();

  const signup = await request('/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: baseUrl.origin },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signup.response.status, 201);
  const signupBody = parseJson(signup);
  userId = signupBody.user.id;
  assert.match(userId, /^[0-9a-f-]{36}$/i);
  const authorization = { Authorization: `Bearer ${signupBody.accessToken}` };

  await seedIssueData();
  await assertLatestInteractionQuery();

  const memberFirst = await request('/feed', { headers: authorization });
  const memberFirstBody = assertFeedPage(memberFirst);
  assert.equal(memberFirstBody.items.length, 10);
  assert.equal(typeof memberFirstBody.nextCursor, 'string');
  const memberCursor = memberFirstBody.nextCursor;

  const memberSecond = await request(`/feed?cursor=${encodeURIComponent(memberCursor)}`, {
    headers: authorization,
  });
  const memberSecondBody = assertFeedPage(memberSecond);
  assert.equal(memberSecondBody.items.length, 2);
  assert.equal(memberSecondBody.nextCursor, null);
  assert.equal(
    new Set([...memberFirstBody.items, ...memberSecondBody.items].map((item) => item.issueId)).size,
    12,
  );
  assert.ok(
    [...memberFirstBody.items, ...memberSecondBody.items].some(
      (item) => item.issueId === issueIds[2] && item.reasonCodes.includes('FOLLOW_UP_LIKE'),
    ),
  );
  const memberReplay = await request(`/feed?cursor=${encodeURIComponent(memberCursor)}`, {
    headers: authorization,
  });
  assert.deepEqual(parseJson(memberReplay), memberSecondBody);

  const memberDetail = await request(`/issues/${issueIds[0]}`, { headers: authorization });
  assert.equal(memberDetail.response.status, 200);
  assert.match(memberDetail.response.headers.get('cache-control') ?? '', /private/);
  assert.match(memberDetail.response.headers.get('cache-control') ?? '', /no-store/);
  assert.ok(parseJson(memberDetail).impacts.some((impact) => impact.targetValue === 'AGE_19_34'));
  const guestDetail = await request(`/issues/${issueIds[0]}`);
  assert.equal(guestDetail.response.status, 200);
  assert.equal(parseJson(guestDetail).impacts.length, 0);

  const guestFirst = await request('/feed');
  const guestFirstBody = assertFeedPage(guestFirst);
  const firstGuestCookie = guestCookie(guestFirst);
  assert.equal(guestFirstBody.items.length, 10);
  assert.equal(typeof guestFirstBody.nextCursor, 'string');
  const guestCursor = guestFirstBody.nextCursor;
  const guestSecond = await request(`/feed?cursor=${encodeURIComponent(guestCursor)}`, {
    headers: { Cookie: firstGuestCookie },
  });
  const guestSecondBody = assertFeedPage(guestSecond);
  assert.equal(guestSecondBody.items.length, 4);
  assert.equal(guestSecondBody.nextCursor, null);
  assert.equal(
    new Set([...guestFirstBody.items, ...guestSecondBody.items].map((item) => item.issueId)).size,
    14,
  );
  const guestReplay = await request(`/feed?cursor=${encodeURIComponent(guestCursor)}`, {
    headers: { Cookie: firstGuestCookie },
  });
  assert.deepEqual(parseJson(guestReplay), guestSecondBody);

  const secondGuest = await request('/feed');
  const secondGuestCookie = guestCookie(secondGuest);
  const crossGuest = await request(`/feed?cursor=${encodeURIComponent(guestCursor)}`, {
    headers: { Cookie: secondGuestCookie },
  });
  assert.equal(crossGuest.response.status, 404);
  assert.equal(parseJson(crossGuest).code, 'NOT_FOUND');

  const guestOnMember = await request(`/feed?cursor=${encodeURIComponent(memberCursor)}`, {
    headers: { Cookie: firstGuestCookie },
  });
  assert.equal(guestOnMember.response.status, 404);
  const memberOnGuest = await request(`/feed?cursor=${encodeURIComponent(guestCursor)}`, {
    headers: authorization,
  });
  assert.equal(memberOnGuest.response.status, 404);

  const invalidCursor = await request('/feed?cursor=not-a-cursor');
  assert.equal(invalidCursor.response.status, 400);
  assert.equal(parseJson(invalidCursor).code, 'INVALID_ARGUMENT');

  await expireMemberSession();
  const expiredCursor = await request(`/feed?cursor=${encodeURIComponent(memberCursor)}`, {
    headers: authorization,
  });
  assert.equal(expiredCursor.response.status, 410);
  assert.equal(parseJson(expiredCursor).code, 'GONE');

  console.log(
    'Compose issue data smoke passed: seeded PostgreSQL cards, member+guest cursor pages, replay/owner binding, public detail filtering, and expiry',
  );
} finally {
  if (orm !== undefined) {
    try {
      await cleanup();
    } finally {
      await orm.close(true);
    }
  }
}
