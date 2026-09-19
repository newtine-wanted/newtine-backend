/* global console, process */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoveryOrm } from './news-discovery.mjs';
import { generateUuidV7 } from '../dist/libs/core/src/common/id/uuidV7.generator.js';
import { executePostgresSql as sql } from '../dist/libs/core/src/common/database/postgresSql.js';
import { DiscoveryRepository } from '../dist/apps/batch/src/discovery/discovery.repository.js';
import { DiscoveryService } from '../dist/apps/batch/src/discovery/discovery.service.js';

// This executable cannot target an application/production DB even if .env changes.
assert.equal(process.env.DB_HOST, '127.0.0.1');
assert.equal(process.env.DB_PORT, '55432');
assert.equal(process.env.DB_NAME, 'news_discovery_local');
const config = JSON.parse(await readFile('config/news-discovery.json', 'utf8'));
const orm = await discoveryOrm();
try {
  const em = orm.em.fork();
  const store = new DiscoveryRepository(em, config.entityTypes);
  const dates = await sql(
    em,
    "select coalesce(max(day)::text, '2000-01-01') as day from news_discovery_runs where day < '2020-01-01'",
  );
  const at = new Date(Date.parse(`${dates[0].day}T03:00:00Z`) + 86400_000);
  const before = new Date(at.getTime() - 86400_000).toISOString();
  const articleDate = new Date(at.getTime() - 3600_000).toISOString();
  const expiry = new Date(at.getTime() + 86400_000).toISOString();
  const issueId = generateUuidV7();
  const expiredId = generateUuidV7();
  const disabledId = generateUuidV7();
  for (const id of [issueId, expiredId, disabledId]) {
    await sql(
      em,
      "insert into issues(id, category_code, title, publication_status) values ($1, 'politics', '검증용 법안 발의', 'PUBLISHED')",
      [id],
    );
    await sql(
      em,
      'insert into news_follow_up_tracks(issue_id, keywords, last_checked_at, expires_at, enabled) values ($1, $2::jsonb, $3, $4, $5)',
      [
        id,
        JSON.stringify(['검증 법안']),
        before,
        id === expiredId ? new Date(at.getTime() - 1000).toISOString() : expiry,
        id !== disabledId,
      ],
    );
  }
  const entityIds = [generateUuidV7(), generateUuidV7(), generateUuidV7(), generateUuidV7()];
  for (const [index, type] of ['POLITICIAN', 'INSTITUTION', 'PARTY', 'POLITICIAN'].entries()) {
    await sql(em, 'insert into entities(id, name, type, is_active) values ($1, $2, $3, $4)', [
      entityIds[index],
      `검증주체 ${index}`,
      type,
      index < 3,
    ]);
  }
  await sql(
    em,
    'insert into issue_entities(issue_entities_id, issue_id, entity_id) values ($1, $2, $3)',
    [generateUuidV7(), issueId, entityIds[0]],
  );
  const catalog = await store.catalog(before);
  for (const id of entityIds.slice(0, 3))
    assert.ok(catalog.some((q) => q.origins.some((o) => o.endsWith(id))));
  assert.ok(!catalog.some((q) => q.origins.some((o) => o.endsWith(entityIds[3]))));
  assert.ok((await store.tracks(at.toISOString()))[0].keywords.includes('검증주체 0'));

  assert.ok(catalog.some((q) => q.origins.includes('TOPIC:politics')));
  assert.equal(catalog.filter((q) => q.origins.some((o) => o.startsWith('REGION:'))).length, 17);
  assert.ok(catalog.every((q) => !q.origins.some((o) => o.startsWith('AGE'))));
  assert.deepEqual(
    (await store.tracks(at.toISOString())).map((t) => t.issueId),
    [issueId],
  );
  const countsBefore = await sql(em, 'select count(*)::int as count from issues');
  let calls = 0;
  let failOnce = true;
  const search = {
    search: async (query, limit) => {
      assert.equal(limit, 50);
      calls++;
      if (calls === 2 && failOnce) {
        failOnce = false;
        throw new Error('SMOKE_FAILURE');
      }
      return [
        {
          title: `${query} 법안 통과`,
          sourceUrl: `https://example.com/${encodeURIComponent(query)}`,
          description: 'never sent',
          publisherName: 'fixture',
          publishedAt: articleDate,
        },
      ];
    },
  };
  const model = {
    extract: async (titles) => [{ title: titles[0], titleIndexes: [0] }],
    groups: async (titles) => [titles.map((_, i) => i)],
    newDevelopments: async () => [0],
  };
  const service = new DiscoveryService(store, search, model);
  await assert.rejects(service.execute(config, at), /SMOKE_FAILURE/);
  const failed = await sql(
    em,
    "select * from news_discovery_runs where error_code = 'SMOKE_FAILURE' and snapshot->>'at' = $1",
    [at.toISOString()],
  );
  const runId = failed.at(-1).id;
  assert.equal(failed.at(-1).snapshot.results.length, 1);
  assert.equal(
    new Date(
      (
        await sql(em, 'select last_checked_at from news_follow_up_tracks where issue_id=$1', [
          issueId,
        ])
      )[0].last_checked_at,
    ).toISOString(),
    before,
  );
  const run = await service.execute(config, at);
  assert.equal(run.id, runId);
  assert.equal(run.completed, true);
  assert.equal(run.snapshot.candidates.length, 1);
  assert.ok(run.snapshot.candidates[0].parentIssueIds.includes(issueId));
  const completedCalls = calls;
  await service.execute(config, at);
  assert.equal(calls, completedCalls);
  assert.deepEqual(await sql(em, 'select count(*)::int as count from issues'), countsBefore);
  assert.equal(
    new Date(
      (
        await sql(em, 'select last_checked_at from news_follow_up_tracks where issue_id=$1', [
          issueId,
        ])
      )[0].last_checked_at,
    ).toISOString(),
    at.toISOString(),
  );
  const nextAt = new Date(at.getTime() + 86400_000);
  const contenders = await Promise.allSettled([
    store.claim(nextAt, config),
    new DiscoveryRepository(orm.em.fork(), config.entityTypes).claim(nextAt, config),
  ]);
  assert.equal(contenders.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(contenders.filter((r) => r.status === 'rejected').length, 1);
  const claim = contenders.find((r) => r.status === 'fulfilled').value;
  await assert.rejects(store.claim(nextAt, config), /ALREADY_RUNNING/);
  await assert.rejects(
    store.claim(new Date(nextAt.getTime() + 86400_000), config),
    /ALREADY_RUNNING/,
  );
  await sql(
    em,
    "update news_discovery_runs set heartbeat_at = now() - interval '6 minutes' where id = $1",
    [claim.id],
  );
  const reclaimed = await store.claim(nextAt, config);
  assert.notEqual(reclaimed.owner, claim.owner);
  await assert.rejects(store.save(claim), /LEASE_LOST/);
  await assert.rejects(store.complete(claim), /LEASE_LOST/);
  // Force a tracking write failure after the completion update; both must roll back.
  reclaimed.snapshot.tracks = [
    {
      issueId,
      title: '검증',
      keywords: [],
      lastCheckedAt: at.toISOString(),
      expiresAt: expiry,
      knownTitles: [],
    },
  ];
  reclaimed.snapshot.at = before;
  await sql(
    em,
    `create function discovery_smoke_reject_tracking() returns trigger language plpgsql as
    'begin raise exception ''SMOKE_ROLLBACK''; end';
    create trigger discovery_smoke_reject_tracking before update on news_follow_up_tracks
    for each row execute function discovery_smoke_reject_tracking()`,
  );
  try {
    await assert.rejects(store.complete(reclaimed), /SMOKE_ROLLBACK/);
    assert.equal(
      (await sql(em, 'select status from news_discovery_runs where id=$1', [reclaimed.id]))[0]
        .status,
      'RUNNING',
    );
  } finally {
    await sql(
      em,
      'drop trigger discovery_smoke_reject_tracking on news_follow_up_tracks; drop function discovery_smoke_reject_tracking()',
    );
  }
  await store.fail(reclaimed, 'SMOKE_DONE');
  // Keep evidence and fixture IDs for audit; prevent fixture actors from entering future live searches.
  await sql(em, 'update entities set is_active = false where id = any($1::uuid[])', [entityIds]);
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        runId,
        checks: [
          'base migrations',
          'catalog/no generations',
          'active actor types',
          'linked actor query',
          'expiry/disabled tracking',
          'persisted checkpoint',
          'failure watermark',
          'resume',
          'global merge/provenance',
          'same-day idempotency',
          'no issue publication',
          'atomic tracking update',
          'transaction rollback',
          'concurrent claims',
          'stale lease fencing',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await orm.close(true);
}
