/* global process, console */
import assert from 'node:assert/strict';
import { validationOrm } from './news-validation.mjs';
import { executePostgresSql as sql } from '../dist/libs/core/src/common/database/postgresSql.js';
import { generateUuidV7 as uuid } from '../dist/libs/core/src/common/id/uuidV7.generator.js';
import { GenerationRepository } from '../dist/apps/batch/src/generation/generation.repository.js';
import { GENERATIONS } from '../dist/apps/batch/src/generation/generation.types.js';
import {
  calculateScores,
  eventTime,
  termKey,
} from '../dist/apps/batch/src/generation/generation.policy.js';
import { ValidationRepository } from '../dist/apps/batch/src/validation/validation.repository.js';
import { ValidationService } from '../dist/apps/batch/src/validation/validation.service.js';
class ToneValidationService extends ValidationService {
  constructor(store, model) {
    super(store, model, undefined, true);
  }
}
assert.equal(process.env.DB_HOST, '127.0.0.1');
assert.equal(process.env.DB_PORT, '55432');
assert.equal(process.env.DB_NAME, 'news_discovery_local');
const orm = await validationOrm();
try {
  const em = orm.em.fork(),
    store = new ValidationRepository(em);
  const before = await sql(em, 'select count(*)::int n from issues');
  const at = new Date('2026-09-20T03:00:00Z'),
    config = { bodyCharacters: 18000, freshnessHalfLifeHours: 72, maxTrackingDays: 30 };
  const articles = [0, 1].map((i) => ({
    articleId: uuid(),
    title: `정부 주거 지원 ${i}`,
    body: '정부가 주거 지원을 발표했어요.',
    publishedAt: '2026-09-19T03:00:00Z',
    sourceUrl: `https://example.com/${uuid()}`,
    publisherName: 'fixture',
  }));
  const selected = articles.map((a) => ({ ...a, id: a.articleId, description: '요약' }));
  const draft = {
    title: '정부 주거 지원',
    eventAt: null,
    eventEvidence: null,
    integratedSummary: '정부가 주거 지원을 발표했어요.',
    summaryLines: ['정부 발표', '주거 지원', '대상자 확인'],
    viewpoints: [
      { stakeholder: '정부', statement: '지원을 발표했어요.', articleIds: [articles[0].articleId] },
      {
        stakeholder: '대상 주민',
        statement: '지원 대상이에요.',
        articleIds: [articles[1].articleId],
      },
    ],
    sharedConditionalImpact: null,
    impacts: GENERATIONS.map((generation) => ({
      generation,
      description: '직접적인 영향은 확인되지 않았어요.',
      articleIds: [],
    })),
    generations: [],
    llmEstimatedImportance: 0.5,
    importanceReason: '주거 정책',
    terms: [],
    followUp: { enabled: false, days: 0, queries: [], reason: '일정 없음' },
  };
  const current = {
    source: {
      candidate: {
        id: uuid(),
        title: '정부 지원',
        articles: selected,
        queries: [],
        origins: [],
        parentIssueIds: [],
        mergedCandidateIds: [],
      },
      status: 'SELECTED',
      articles: selected,
      selectedArticles: selected,
    },
    articles,
    fetchFailures: [],
    draft,
    classification: { topics: [], regions: [], entities: [], generations: [] },
    glossary: [],
    status: 'GENERATED',
  };
  Object.assign(current, eventTime(draft, articles, at.toISOString(), selected));
  current.scores = calculateScores(current, at.toISOString(), config);
  const catalog = await new GenerationRepository(em).catalog();
  const ids = [];
  async function source(status = 'COMPLETED') {
    const d = uuid(),
      c = uuid(),
      g = uuid(),
      owner = uuid();
    ids.push([d, c, g]);
    const days = await sql(
      em,
      "select coalesce(max(day),date '2000-01-01') + 1 as day from news_discovery_runs where day < '2020-01-01'",
    );
    await sql(
      em,
      "insert into news_discovery_runs(id,day,owner,status,snapshot) values($1,$2,$3,'COMPLETED','{}')",
      [d, days[0].day, owner],
    );
    await sql(
      em,
      "insert into news_collection_runs(id,discovery_run_id,owner,status,snapshot) values($1,$2,$3,'COMPLETED','{}')",
      [c, d, owner],
    );
    await sql(
      em,
      'insert into news_generation_runs(id,collection_run_id,owner,status,snapshot) values($1,$2,$3,$4,$5::jsonb)',
      [
        g,
        c,
        owner,
        status,
        JSON.stringify({ at: at.toISOString(), config, catalog, results: [current], usage: [] }),
      ],
    );
    return g;
  }
  await assert.rejects(store.claim(await source('FAILED'), at), /COMPLETED_GENERATION_REQUIRED/);
  const newTerm = `검증용어 ${uuid()}`;
  const existingTerm = `기존용어 ${uuid()}`;
  const heldTerm = `보류용어 ${uuid()}`;
  const staleTerm = `소유권용어 ${uuid()}`;
  const rollbackTerm = `롤백용어 ${uuid()}`;
  await sql(em, 'insert into news_terms(normalized_term,term,definition) values($1,$2,$3)', [
    termKey(existingTerm),
    existingTerm,
    '기존 설명',
  ]);
  current.draft.terms = [newTerm, existingTerm];
  current.draft.summaryLines[2] = `${newTerm}, ${existingTerm} 확인`;
  current.glossary = [
    { term: newTerm, definition: '새 설명', source: 'GENERATED' },
    { term: existingTerm, definition: '덮어쓰면 안 되는 설명', source: 'GENERATED' },
  ];
  const sourceId = await source();
  let calls = 0,
    repairs = 0;
  const model = {
    usage: [],
    review: async () => {
      calls++;
      if (calls === 1)
        return {
          findings: [{ field: 'title', category: 'TONE', reason: '제목 수정', articleIds: [] }],
        };
      if (calls === 2) throw new Error('API_FAILED');
      return { findings: [] };
    },
    repair: async () => {
      repairs++;
      return [{ field: 'title', value: '주거 지원 발표' }];
    },
  };
  const service = new ToneValidationService(store, model);
  await assert.rejects(service.execute(sourceId, at), /API_FAILED/);
  const run = await service.execute(sourceId, at);
  assert.equal(run.snapshot.results[0].status, 'PASSED');
  assert.deepEqual(
    await new GenerationRepository(em).terms([newTerm.toUpperCase(), existingTerm]),
    [
      { term: newTerm, definition: '새 설명', source: 'DATABASE' },
      { term: existingTerm, definition: '기존 설명', source: 'DATABASE' },
    ].sort((a, b) => (termKey(a.term) < termKey(b.term) ? -1 : 1)),
  );
  assert.equal(repairs, 1);
  assert.equal(calls, 3);
  await service.execute(sourceId, at);
  assert.equal(calls, 3);
  assert.equal(run.snapshot.results[0].original.draft.title, '정부 주거 지원');
  assert.equal(run.snapshot.validationMode, 'TONE');
  // Simulate a completed legacy AI run: the new policy must not reuse its verdict.
  await sql(em, "update news_validation_runs set validation_mode='AI' where id=$1", [run.id]);
  const toneRun = await service.execute(sourceId, at);
  assert.notEqual(toneRun.id, run.id);
  assert.equal(toneRun.snapshot.validationMode, 'TONE');
  assert.equal(toneRun.snapshot.results[0].original.draft.title, '정부 주거 지원');
  const rulesRun = await new ValidationService(store).execute(sourceId, at);
  assert.notEqual(rulesRun.id, run.id);
  assert.equal(rulesRun.snapshot.aiValidationEnabled, false);
  assert.equal(rulesRun.snapshot.results[0].status, 'PASSED');
  assert.equal(rulesRun.snapshot.results[0].current.draft.title, '정부 주거 지원');
  assert.equal(rulesRun.snapshot.usage.length, 0);
  assert.equal(
    (
      await sql(em, 'select count(*)::int n from news_validation_runs where generation_run_id=$1', [
        sourceId,
      ])
    )[0].n,
    3,
  );
  assert.equal((await new ValidationService(store).execute(sourceId, at)).id, rulesRun.id);
  const activeSource = await source();
  const active = await store.claim(activeSource, at);
  await assert.rejects(store.claim(activeSource, at), /VALIDATION_ALREADY_RUNNING/);
  await sql(
    em,
    "update news_validation_runs set heartbeat_at=now()-interval '6 minutes' where id=$1",
    [active.id],
  );
  const resumed = await store.claim(activeSource, at);
  await assert.rejects(store.save(active), /VALIDATION_LEASE_LOST/);
  active.snapshot.results[0].status = 'PASSED';
  active.snapshot.results[0].current.glossary = [
    { term: staleTerm, definition: '저장 금지', source: 'GENERATED' },
  ];
  await assert.rejects(store.complete(active), /VALIDATION_LEASE_LOST/);
  await store.fail(active, 'STALE');
  await store.heartbeat(resumed);
  await store.fail(resumed, 'SMOKE_COMPLETE');
  assert.deepEqual(await new GenerationRepository(em).terms([staleTerm]), []);
  current.draft.terms = [heldTerm];
  current.draft.summaryLines[2] = `${heldTerm} 확인`;
  current.glossary = [{ term: heldTerm, definition: '보류 설명', source: 'GENERATED' }];
  const heldSource = await source();
  const held = await new ToneValidationService(store, {
    usage: [],
    review: async () => ({
      findings: [{ field: 'title', category: 'TONE', reason: '반복 실패', articleIds: [] }],
    }),
    repair: async () => [{ field: 'title', value: '지원 발표' }],
  }).execute(heldSource, at);
  assert.equal(held.snapshot.results[0].status, 'HELD');
  assert.deepEqual(await new GenerationRepository(em).terms([heldTerm]), []);
  const rollback = await store.claim(await source(), at);
  rollback.snapshot.results[0].status = 'PASSED';
  rollback.snapshot.results[0].current.glossary = [
    { term: rollbackTerm, definition: '롤백되어야 함', source: 'GENERATED' },
    { term: `${rollbackTerm} invalid`, definition: '', source: 'GENERATED' },
  ];
  await assert.rejects(store.complete(rollback), /INVALID_NEWS_TERM/);
  assert.equal(rollback.completed, false);
  assert.equal(
    (await sql(em, 'select status from news_validation_runs where id=$1', [rollback.id]))[0].status,
    'RUNNING',
  );
  assert.deepEqual(await new GenerationRepository(em).terms([rollbackTerm]), []);
  await store.fail(rollback, 'SMOKE_ROLLBACK');
  await sql(em, 'delete from news_terms where normalized_term = any($1::text[])', [
    [newTerm, existingTerm, heldTerm, staleTerm, rollbackTerm].map(termKey),
  ]);
  assert.deepEqual(await sql(em, 'select count(*)::int n from issues'), before);
  console.log(
    JSON.stringify({ smoke: 'validation', passed: true, runId: run.id, heldRunId: held.id }),
  );
  // Remove only this script's synthetic sources; real runs remain intact.
  for (const [d, c, g] of ids) {
    await sql(em, 'delete from news_validation_runs where generation_run_id=$1', [g]);
    await sql(em, 'delete from news_generation_runs where id=$1', [g]);
    await sql(em, 'delete from news_collection_runs where id=$1', [c]);
    await sql(em, 'delete from news_discovery_runs where id=$1', [d]);
  }
} finally {
  await orm.close(true);
}
