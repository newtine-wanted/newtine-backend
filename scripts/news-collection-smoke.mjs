/* global console, process */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectionOrm } from './news-collection.mjs';
import { generateUuidV7 } from '../dist/libs/core/src/common/id/uuidV7.generator.js';
import { executePostgresSql as sql } from '../dist/libs/core/src/common/database/postgresSql.js';
import { CollectionRepository } from '../dist/apps/batch/src/collection/collection.repository.js';
import { CollectionService } from '../dist/apps/batch/src/collection/collection.service.js';

assert.equal(process.env.DB_HOST, '127.0.0.1');
assert.equal(process.env.DB_PORT, '55432');
assert.equal(process.env.DB_NAME, 'news_discovery_local');
const config = JSON.parse(await readFile('config/news-collection.json', 'utf8'));
const discoveryConfig = JSON.parse(await readFile('config/news-discovery.json', 'utf8'));
const orm = await collectionOrm();
try {
  await orm.migrator.up();
  const em = orm.em.fork();
  const store = new CollectionRepository(em);
  const dates = await sql(
    em,
    "select coalesce(max(day)::text, '2000-01-01') as day from news_discovery_runs where day < '2020-01-01'",
  );
  const at = new Date(Date.parse(`${dates[0].day}T03:00:00Z`) + 10 * 86400_000);
  const iso = at.toISOString();
  const articleTime = new Date(at.getTime() - 3600_000).toISOString();
  const issueTitle = '국회 검증용 주거 지원 법안 통과';
  const issueIds = [];
  for (let i = 0; i < 12; i++) {
    const id = generateUuidV7();
    issueIds.push(id);
    await sql(
      em,
      "insert into issues (id, category_code, title, publication_status, published_at) values ($1, 'politics', $2, 'PUBLISHED', $3)",
      [
        id,
        i === 0 ? issueTitle : `${issueTitle} 보도 ${i}`,
        new Date(at.getTime() - 86400_000).toISOString(),
      ],
    );
  }
  const excluded = [];
  for (const [status, publishedAt] of [
    ['PUBLISHED', new Date(at.getTime() - 7 * 86400_000 - 1).toISOString()],
    ['UNPUBLISHED', iso],
    ['WITHDRAWN', iso],
    ['PUBLISHED', new Date(at.getTime() + 1).toISOString()],
    ['PUBLISHED', null],
  ]) {
    const id = generateUuidV7();
    excluded.push(id);
    await sql(
      em,
      "insert into issues (id, category_code, title, publication_status, published_at) values ($1, 'politics', $2, $3, $4)",
      [id, issueTitle, status, publishedAt],
    );
  }
  const similar = await store.similar(issueTitle, iso);
  assert.equal(similar.length, 10);
  assert.equal(similar[0].id, issueIds[0]);
  assert.equal(Number(similar[0].similarity), 1);
  assert.ok(
    similar.every(
      (r, i) =>
        !excluded.includes(r.id) &&
        (i === 0 || Number(similar[i - 1].similarity) >= Number(r.similarity)),
    ),
  );
  // Inclusive lower boundary, and published time rather than recently-created rows.
  const boundaryAt = new Date(at.getTime() - 7 * 86400_000).toISOString();
  const boundaryId = generateUuidV7();
  await sql(
    em,
    "insert into issues (id, category_code, title, publication_status, published_at) values ($1, 'politics', '경계 검증 유일 제목', 'PUBLISHED', $2)",
    [boundaryId, boundaryAt],
  );
  assert.equal((await store.similar('경계 검증 유일 제목', iso))[0].id, boundaryId);
  const article = (i, title) => ({
    title: `${title} 관련 보도 ${i}`,
    description: '검증 요약',
    sourceUrl: `https://${i === 6 ? 'yna.co.kr' : 'example.com'}/${encodeURIComponent(title)}/${i}`,
    publisherName: 'fixture',
    publishedAt: articleTime,
  });
  const candidates = ['중복', '새 전개', '기사 부족', '검색 없음'].map((title) => ({
    id: generateUuidV7(),
    title,
    articles: [article(0, title)],
    queries: ['국회'],
    origins: ['TOPIC:politics'],
    parentIssueIds: [issueIds[0]],
    mergedCandidateIds: [],
  }));
  async function source(offset, status = 'COMPLETED') {
    const id = generateUuidV7();
    const day = new Date(at.getTime() + offset * 86400_000).toISOString().slice(0, 10);
    await sql(
      em,
      'insert into news_discovery_runs (id, day, owner, status, snapshot) values ($1, $2, $3, $4, $5::jsonb)',
      [
        id,
        day,
        generateUuidV7(),
        status,
        JSON.stringify({ at: iso, config: discoveryConfig, candidates, results: [], usage: [] }),
      ],
    );
    return id;
  }
  await assert.rejects(
    store.claim(await source(0, 'FAILED'), at, config),
    /COMPLETED_DISCOVERY_REQUIRED/,
  );
  const sourceId = await source(1);
  let searches = 0,
    duplicateCalls = 0,
    failOnce = true;
  const model = {
    usage: [],
    duplicates: async (c) => {
      duplicateCalls++;
      return c.title === '중복' ? [0] : [];
    },
    relevant: async (c) => {
      model.usage.push({ stage: 'relevant', model: 'mock', inputTokens: 10 });
      if (failOnce) {
        failOnce = false;
        throw new Error('SMOKE_RELEVANCE_FAILURE');
      }
      return c.title === '기사 부족' ? [0] : [0, 1, 2, 3, 4, 5, 6];
    },
  };
  const service = new CollectionService(
    store,
    {
      search: async (query, limit) => {
        searches++;
        assert.equal(limit, 50);
        return query === '검색 없음' ? [] : Array.from({ length: 7 }, (_, i) => article(i, query));
      },
    },
    model,
  );
  const countBefore = (await sql(em, 'select count(*)::int as count from issues'))[0].count;
  await assert.rejects(service.execute(sourceId, config, at), /SMOKE_RELEVANCE_FAILURE/);
  const failed = (
    await sql(em, 'select * from news_collection_runs where discovery_run_id = $1', [sourceId])
  )[0];
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.snapshot.results[0].status, 'DUPLICATE');
  assert.equal(failed.snapshot.results[1].articles.length, 7);
  assert.equal(failed.snapshot.usage.length, 1);
  const run = await service.execute(sourceId, config, new Date(at.getTime() + 999999));
  assert.equal(run.id, failed.id);
  assert.equal(run.snapshot.at, iso);
  assert.deepEqual(
    run.snapshot.results.map((r) => r.status),
    ['DUPLICATE', 'SELECTED', 'INSUFFICIENT_ARTICLES', 'INSUFFICIENT_ARTICLES'],
  );
  assert.equal(run.snapshot.results[1].selectedArticles.length, 5);
  assert.ok(run.snapshot.results[1].selectedArticles[0].sourceUrl.startsWith('https://yna.co.kr/'));
  assert.deepEqual(run.snapshot.results[1].candidate.parentIssueIds, [issueIds[0]]);
  assert.equal(searches, 3);
  assert.equal(duplicateCalls, 4);
  await service.execute(sourceId, config, at);
  assert.equal(searches, 3);
  assert.equal(duplicateCalls, 4);
  assert.equal((await sql(em, 'select count(*)::int as count from issues'))[0].count, countBefore);
  // Separate connections compete for one lease; stale owners cannot overwrite checkpoints.
  const nextSource = await source(2);
  const other = new CollectionRepository(orm.em.fork());
  const claims = await Promise.allSettled([
    store.claim(nextSource, at, config),
    other.claim(nextSource, at, config),
  ]);
  assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(
    claims.find((r) => r.status === 'rejected').reason.message,
    /COLLECTION_ALREADY_RUNNING/,
  );
  const old = claims.find((r) => r.status === 'fulfilled').value;
  await sql(
    em,
    "update news_collection_runs set heartbeat_at = now() - interval '6 minutes' where id = $1",
    [old.id],
  );
  const replacement = await other.claim(nextSource, at, config);
  assert.notEqual(old.owner, replacement.owner);
  await assert.rejects(store.save(old), /COLLECTION_LEASE_LOST/);
  await assert.rejects(store.heartbeat(old), /COLLECTION_LEASE_LOST/);
  await assert.rejects(store.complete(old), /COLLECTION_LEASE_LOST/);
  await store.fail(old, 'STALE_OWNER');
  assert.equal(
    (await sql(em, 'select status from news_collection_runs where id = $1', [old.id]))[0].status,
    'RUNNING',
  );
  await other.fail(replacement, 'SMOKE_FINISHED');
  console.log(
    JSON.stringify({
      passed: true,
      runId: run.id,
      discoveryRunId: sourceId,
      similarityCount: similar.length,
      counts: { selected: 1, duplicate: 1, insufficient: 2 },
      searches,
      duplicateCalls,
    }),
  );
} finally {
  await orm.close(true);
}
