/* global process, console */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generationOrm } from './news-generation.mjs';
import { executePostgresSql as sql } from '../dist/libs/core/src/common/database/postgresSql.js';
import { generateUuidV7 } from '../dist/libs/core/src/common/id/uuidV7.generator.js';
import { GenerationRepository } from '../dist/apps/batch/src/generation/generation.repository.js';
import { GenerationService } from '../dist/apps/batch/src/generation/generation.service.js';
import { GENERATIONS } from '../dist/apps/batch/src/generation/generation.types.js';
assert.equal(process.env.DB_HOST, '127.0.0.1');
assert.equal(process.env.DB_PORT, '55432');
assert.equal(process.env.DB_NAME, 'news_discovery_local');
const config = JSON.parse(await readFile('config/news-generation.json', 'utf8'));
const orm = await generationOrm();
try {
  await orm.migrator.up();
  const em = orm.em.fork();
  const store = new GenerationRepository(em);
  const before = await sql(em, 'select count(*)::int as n from issues');
  const id = generateUuidV7();
  const sourceId = generateUuidV7();
  const owner = generateUuidV7();
  const date = await sql(
    em,
    "select coalesce(max(day), date '2000-01-01') + 1 as day from news_discovery_runs where day < '2020-01-01'",
  );
  await sql(
    em,
    "insert into news_discovery_runs(id,day,owner,status,snapshot) values($1,$2,$3,'COMPLETED','{}')",
    [id, date[0].day, owner],
  );
  const at = '2026-09-20T03:00:00Z';
  const article = (i) => ({
    title: `서울 주거 발표 ${i}`,
    description: '검색 요약',
    sourceUrl: `https://example.com/${id}/${i}`,
    publisherName: 'fixture',
    publishedAt: '2026-09-19T03:00:00Z',
  });
  const candidate = {
    id: generateUuidV7(),
    title: '서울 주거 발표',
    articles: [article(0)],
    queries: [],
    origins: [],
    parentIssueIds: [],
    mergedCandidateIds: [],
  };
  const source = {
    at,
    config: { articlesPerQuery: 50, publishers: [] },
    usage: [],
    results: [
      {
        candidate,
        status: 'SELECTED',
        selectedArticles: [article(0), article(1)],
        articles: [article(0), article(1)],
      },
      {
        candidate: { ...candidate, id: generateUuidV7() },
        status: 'SELECTED',
        selectedArticles: [article(2), article(3)],
        articles: [article(2), article(3)],
      },
      {
        candidate: { ...candidate, id: generateUuidV7() },
        status: 'INSUFFICIENT_ARTICLES',
        selectedArticles: [],
      },
    ],
  };
  await sql(
    em,
    "insert into news_collection_runs(id,discovery_run_id,owner,status,snapshot) values($1,$2,$3,'FAILED',$4::jsonb)",
    [sourceId, id, owner, JSON.stringify(source)],
  );
  await assert.rejects(
    store.claim(sourceId, new Date(at), config),
    /COMPLETED_COLLECTION_REQUIRED/,
  );
  await sql(em, "update news_collection_runs set status='COMPLETED' where id=$1", [sourceId]);
  const term = `보증금${id}`;
  await sql(em, 'insert into news_terms(normalized_term,term,definition) values($1,$1,$2)', [
    term,
    '맡겨 둔 돈이에요.',
  ]);
  assert.equal((await store.terms([term]))[0].source, 'DATABASE');
  assert.equal((await store.catalog()).topics.length, 10);
  let generated = 0,
    fetched = 0,
    defined = 0,
    classify = 0;
  const model = {
    usage: [],
    generate: async (articles) => {
      generated++;
      return {
        title: '서울 주거 지원',
        eventAt: null,
        eventEvidence: null,
        integratedSummary: `${term} 지원이에요. 신규용어를 설명해요.`,
        summaryLines: ['주거 지원', '서울 발표', '확인된 내용'],
        viewpoints: [
          { stakeholder: '정부', statement: '지원 발표', articleIds: [articles[0].articleId] },
          { stakeholder: '주민', statement: '지원 대상', articleIds: [articles[1].articleId] },
        ],
        impacts: GENERATIONS.map((generation) => ({
          generation,
          description: '현재 확인된 직접적인 영향은 없어요',
          articleIds: [],
        })),
        generations: [],
        llmEstimatedImportance: 0.5,
        importanceReason: '주거 정책',
        terms: [term, '신규용어'],
        followUp: { enabled: false, days: 0, queries: [], reason: '일정 없음' },
      };
    },
    classify: async () => {
      classify++;
      return { topics: [], regions: [], entities: [] };
    },
    define: async (terms) => {
      defined++;
      assert.deepEqual(terms, ['신규용어']);
      if (defined === 1) {
        model.usage.push({
          stage: 'define',
          model: 'gpt-5.4-mini-2026-03-17',
          inputTokens: 10,
          outputTokens: 10,
        });
        throw new Error('OPENAI_INCOMPLETE_OUTPUT');
      }
      return [{ term: '신규용어', definition: '쉽게 설명해요.', source: 'GENERATED' }];
    },
  };
  const bodies = {
    fetch: async (a) => {
      fetched++;
      if (a.sourceUrl.endsWith('/2') || a.sourceUrl.endsWith('/3'))
        throw new Error('BODY_UNAVAILABLE');
      return {
        articleId: a.id,
        title: a.title,
        sourceUrl: a.sourceUrl,
        publisherName: a.publisherName,
        publishedAt: a.publishedAt,
        body: '기사 본문이에요.',
      };
    },
  };
  await assert.rejects(
    new GenerationService(store, bodies, model).execute(sourceId, config, new Date(at)),
    /OPENAI_INCOMPLETE_OUTPUT/,
  );
  const run = await new GenerationService(store, bodies, model).execute(
    sourceId,
    config,
    new Date(at),
  );
  assert.equal(run.completed, true);
  assert.equal(run.snapshot.results.length, 2);
  assert.deepEqual(
    run.snapshot.results.map((r) => r.status),
    ['GENERATED', 'INSUFFICIENT_BODIES'],
  );
  assert.equal(generated, 1);
  assert.equal(fetched, 4);
  assert.equal(classify, 1);
  assert.equal(defined, 2);
  assert.equal(run.snapshot.usage.length, 1);
  const again = await new GenerationService(store, bodies, model).execute(sourceId, config);
  assert.equal(again.id, run.id);
  assert.equal(fetched, 4);
  assert.equal((await store.terms(['신규용어'])).length, 0);
  assert.equal((await sql(em, 'select count(*)::int as n from issues'))[0].n, before[0].n);
  // Reopen this synthetic run only to exercise active claims, stale takeover, and fencing.
  await sql(em, "update news_generation_runs set status='FAILED' where id=$1", [run.id]);
  const active = await store.claim(sourceId, new Date(at), config);
  await assert.rejects(store.claim(sourceId, new Date(at), config), /GENERATION_ALREADY_RUNNING/);
  await sql(
    em,
    "update news_generation_runs set heartbeat_at=now()-interval '6 minutes' where id=$1",
    [run.id],
  );
  const resumed = await store.claim(sourceId, new Date(at), config);
  assert.notEqual(active.owner, resumed.owner);
  await assert.rejects(store.save(active), /GENERATION_LEASE_LOST/);
  await assert.rejects(store.complete(active), /GENERATION_LEASE_LOST/);
  await store.complete(resumed);
  console.log(
    JSON.stringify({
      runId: run.id,
      checks:
        'source, catalog, glossary, body shortage, two viewpoints, resume, usage, reuse, concurrency, fencing, no publishing',
      passed: true,
    }),
  );
} finally {
  await orm.close(true);
}
