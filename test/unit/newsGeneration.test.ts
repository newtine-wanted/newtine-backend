import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { generateUuidV7, type DiscoveredArticle, type FetchedArticle } from '@newtine/core';
import { GenerationService } from '@newtine/batch/generation/generation.service.js';
import { GenerationOpenAiModel } from '@newtine/batch/generation/generation.model.js';
import {
  calculateScores,
  checkedClassification,
  checkDraft,
  estimateCost,
  eventTime,
  parseGenerationConfig,
  ruleClassification,
} from '@newtine/batch/generation/generation.policy.js';
import {
  GENERATIONS,
  type Catalog,
  type Draft,
  type GenerationConfig,
  type GenerationModel,
  type GenerationResult,
  type GenerationRun,
  type GenerationStore,
} from '@newtine/batch/generation/generation.types.js';
const config: GenerationConfig = {
  bodyCharacters: 18000,
  freshnessHalfLifeHours: 72,
  maxTrackingDays: 30,
};
const at = new Date('2026-09-20T03:00:00Z');
const articles: FetchedArticle[] = [0, 1].map((i) => ({
  articleId: generateUuidV7(),
  title: '서울 주거 국토교통부 발표',
  body: '9월 19일 오전 9시에 정부가 보증금 지원을 발표했어요.',
  publishedAt: `2026-09-19T0${i}:00:00Z`,
  sourceUrl: `https://example.com/${i}`,
  publisherName: '언론사',
}));
const draft = (): Draft => ({
  title: '정부, 보증금 지원 발표',
  eventAt: null,
  eventEvidence: null,
  integratedSummary: '정부가 보증금 지원을 발표했어요.',
  summaryLines: ['정부 발표', '보증금 지원', '시행 예정'],
  viewpoints: [
    { stakeholder: '정부', statement: '지원을 발표했어요.', articleIds: [articles[0]!.articleId] },
    {
      stakeholder: '지원 대상 주민',
      statement: '보증금 지원 대상이에요.',
      articleIds: [articles[1]!.articleId],
    },
  ],
  impacts: GENERATIONS.map((generation) => ({
    generation,
    description: '현재 확인된 직접적인 영향은 없어요',
    articleIds: [],
  })),
  generations: [],
  llmEstimatedImportance: 0.5,
  importanceReason: '주거 지원',
  terms: ['보증금'],
  followUp: { enabled: false, days: 0, queries: [], reason: '일정 없음' },
});
const catalog: Catalog = {
  topics: [{ code: 'housing', name: '주거' }],
  regions: [{ code: 'seoul', name: '서울' }],
  entities: [{ code: 'entity', name: '국토교통부' }],
};
function result(): GenerationResult {
  const selected: DiscoveredArticle[] = articles.map((a) => ({
    id: a.articleId,
    ...a,
    description: '요약',
  }));
  return {
    source: {
      candidate: {
        id: 'candidate',
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
    articles: [],
    fetchFailures: [],
  };
}
class Store implements GenerationStore {
  saved?: GenerationRun;
  async claim(): Promise<GenerationRun> {
    return structuredClone(
      this.saved ?? {
        id: 'run',
        owner: 'owner',
        collectionRunId: 'source',
        completed: false,
        snapshot: { at: at.toISOString(), config, results: [result()], usage: [] },
      },
    );
  }
  async catalog() {
    return catalog;
  }
  async terms() {
    return [{ term: '보증금', definition: '맡겨 둔 돈이에요.', source: 'DATABASE' as const }];
  }
  async save(r: GenerationRun) {
    this.saved = structuredClone(r);
  }
  async heartbeat() {}
  async complete(r: GenerationRun) {
    r.completed = true;
    await this.save(r);
  }
  async fail() {}
}
function model(): GenerationModel {
  return {
    usage: [],
    generate: async () => draft(),
    classify: async () => {
      throw new Error('MUST_SKIP_CLASSIFY');
    },
    define: async () => {
      throw new Error('MUST_SKIP_DEFINE');
    },
  };
}
const bodies = {
  fetch: async (a: DiscoveredArticle) => articles.find((b) => b.sourceUrl === a.sourceUrl)!,
};
test('two nonopposing viewpoints complete generation and reuses DB glossary without a definition call', async () => {
  const store = new Store();
  const run = await new GenerationService(store, bodies, model()).execute('source', config, at);
  assert.equal(run.snapshot.results[0]!.status, 'GENERATED');
  assert.equal(run.snapshot.results[0]!.draft!.viewpoints.length, 2);
  assert.equal(run.snapshot.results[0]!.glossary![0]!.source, 'DATABASE');
  assert.equal(run.snapshot.results[0]!.eventAtSource, 'FIRST_REPORT');
  const reused = await new GenerationService(
    store,
    {
      fetch: async () => {
        throw new Error('MUST_NOT_FETCH');
      },
    },
    model(),
  ).execute('source', config, at);
  assert.equal(reused.completed, true);
});
test('body shortage skips paid generation', async () => {
  const m = model();
  m.generate = async () => {
    throw new Error('MUST_NOT_GENERATE');
  };
  const run = await new GenerationService(
    new Store(),
    {
      fetch: async () => {
        throw new Error('UNAVAILABLE');
      },
    },
    m,
  ).execute('source', config, at);
  assert.equal(run.snapshot.results[0]!.status, 'INSUFFICIENT_BODIES');
  assert.equal(run.snapshot.results[0]!.fetchFailures.length, 2);
});
test('checkpoint after generation survives classification error without fetching or generating again', async () => {
  const store = new Store();
  store.catalog = async () => ({ ...catalog, topics: [{ code: 'policy', name: '정책' }] });
  const m = model();
  let calls = 0;
  m.generate = async () => {
    calls++;
    return draft();
  };
  m.classify = async () => {
    m.usage.push({
      stage: 'classify',
      model: 'gpt-5.4-mini-2026-03-17',
      inputTokens: 1,
      outputTokens: 1,
    });
    throw new Error('OPENAI_INCOMPLETE_OUTPUT');
  };
  await assert.rejects(new GenerationService(store, bodies, m).execute('source', config, at));
  assert.equal(store.saved!.snapshot.usage.length, 1);
  m.classify = async () => ({ topics: ['policy'], regions: [], entities: [] });
  const run = await new GenerationService(
    store,
    {
      fetch: async () => {
        throw new Error('MUST_NOT_FETCH');
      },
    },
    m,
  ).execute('source', config, at);
  assert.equal(calls, 1);
  assert.equal(run.snapshot.results[0]!.status, 'GENERATED');
  assert.equal(run.snapshot.usage.length, 1);
});
test('scoring has approved weights, saturation and 72-hour half life', () => {
  const r = result();
  r.draft = draft();
  r.eventAt = '2026-09-17T03:00:00Z';
  let score = calculateScores(r, at.toISOString(), config);
  assert.equal(score.freshness, 0.5);
  assert.ok(Math.abs(score.importance - ((0.4 * 2) / 50 + 0.3 / 10 + 0.3 * 0.5)) < 1e-10);
  r.source.articles = Array.from({ length: 100 }, (_, i) => ({
    ...r.source.articles![0]!,
    publisherName: `P${i}`,
  }));
  r.draft.llmEstimatedImportance = 1;
  score = calculateScores(r, at.toISOString(), config);
  assert.equal(score.importance, 1);
});
test('future or unsupported event timestamp falls back to oldest available report', () => {
  const d = draft();
  d.eventAt = '2026-09-21T00:00:00Z';
  d.eventEvidence = '9월 19일';
  assert.equal(
    eventTime(d, articles, at.toISOString()).eventAt,
    articles[0]!.publishedAt!.replace('Z', '.000Z'),
  );
  d.eventAt = '2026-09-19T00:00:00Z';
  assert.equal(eventTime(d, articles, at.toISOString()).eventAtSource, 'ARTICLE_EVENT');
  d.eventEvidence = '기사에 없는 문구';
  assert.equal(eventTime(d, articles, at.toISOString()).eventAtSource, 'FIRST_REPORT');
});
test('classification uses allowed codes only and does not match Seoul inside a longer proper name', () => {
  assert.deepEqual(ruleClassification(catalog, articles), {
    topics: ['housing'],
    regions: ['seoul'],
    entities: ['entity'],
  });
  assert.deepEqual(
    ruleClassification(catalog, [{ ...articles[0]!, title: '서울대 연구' }]).regions,
    [],
  );
  assert.throws(
    () => checkedClassification({ topics: ['invented'], regions: [], entities: [] }, catalog),
    /INVALID_CLASSIFICATION/,
  );
});
test('draft requires exactly two distinct stakeholders and valid references', () => {
  const d = draft();
  checkDraft(d, articles, config);
  for (const values of [
    [],
    draft().viewpoints.slice(0, 1),
    [...draft().viewpoints, draft().viewpoints[0]!],
  ]) {
    d.viewpoints = values;
    assert.throws(() => checkDraft(d, articles, config), /INVALID_VIEWPOINTS/);
  }
  d.viewpoints = draft().viewpoints;
  d.viewpoints[0]!.articleIds = ['unknown'];
  assert.throws(() => checkDraft(d, articles, config), /INVALID_VIEWPOINTS/);
  const bad = draft();
  bad.llmEstimatedImportance = NaN;
  assert.throws(() => checkDraft(bad, articles, config));
  bad.llmEstimatedImportance = 0.5;
  bad.impacts.pop();
  assert.throws(() => checkDraft(bad, articles, config));
});
test('terms not present in generated text are excluded and tracking bounds are checked', () => {
  const d = draft();
  d.terms = ['보증금', '발명한용어', '보증금'];
  assert.deepEqual(checkDraft(d, articles, config).terms, ['보증금']);
  d.followUp = { enabled: true, days: 31, queries: ['지원'], reason: '시행 예정' };
  assert.throws(() => checkDraft(d, articles, config), /INVALID_FOLLOW_UP/);
  assert.throws(() => parseGenerationConfig({ ...config, freshnessHalfLifeHours: 0 }));
});
test('cost includes cached discount and marks missing usage without inventing zero cost', () => {
  const model = 'gpt-5.4-mini-2026-03-17';
  assert.equal(
    estimateCost([
      {
        stage: 'generate',
        model,
        inputTokens: 1000000,
        cachedInputTokens: 1000000,
        outputTokens: 1000000,
      },
    ]).usd,
    4.575,
  );
  assert.equal(estimateCost([{ stage: 'generate', model }]).incomplete, true);
  assert.equal(
    estimateCost([{ stage: 'generate', model, inputTokens: 1, outputTokens: 1 }])
      .cacheDiscountUnknown,
    true,
  );
});
test('model sends article bodies and UX guide and records cached usage even on incomplete output', async () => {
  let payload: Record<string, unknown> = {};
  const m = new GenerationOpenAiModel('test', '쉬운 말로 쓴다', (async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        status: 'incomplete',
        usage: { input_tokens: 10, output_tokens: 20, input_tokens_details: { cached_tokens: 5 } },
      }),
      { status: 200 },
    );
  }) as typeof fetch);
  await assert.rejects(m.generate(articles, config), /OPENAI_INCOMPLETE_OUTPUT/);
  assert.ok(String(payload.instructions).includes('쉬운 말'));
  assert.ok(String(payload.input).includes(articles[0]!.body));
  assert.equal(m.usage[0]!.cachedInputTokens, 5);
});

test('fallback uses earliest selected report even when its body is unavailable', () => {
  const result = eventTime(draft(), articles, at.toISOString(), [
    { publishedAt: '2026-09-18T00:00:00Z' },
    ...articles,
  ]);
  assert.equal(result.eventAt, '2026-09-18T00:00:00.000Z');
});

test('shared conditional impact gives all generations identical conditions and evidence', () => {
  const d = draft();
  d.sharedConditionalImpact = {
    description: '주택 침수 피해로 임시 거처가 필요한 사람이라면 월세 지원을 받을 수 있어요.',
    articleIds: [articles[0]!.articleId],
  };
  const result = checkDraft(d, articles, config);
  assert.ok(result.impacts.every((i) => i.description === d.sharedConditionalImpact!.description));
  assert.ok(
    result.impacts.every(
      (i) => JSON.stringify(i.articleIds) === JSON.stringify(d.sharedConditionalImpact!.articleIds),
    ),
  );
  d.sharedConditionalImpact.articleIds = ['unknown'];
  assert.throws(() => checkDraft(d, articles, config), /INVALID_SHARED_IMPACT/);
});

test('generation rejects more than three terms', () => {
  const d = draft();
  d.terms = ['보증금', '주거', '지원', '정부'];
  assert.throws(() => checkDraft(d, articles, config), /INVALID_TERMS/);
});
