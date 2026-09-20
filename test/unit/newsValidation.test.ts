import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { generateUuidV7, type DiscoveredArticle, type FetchedArticle } from '@newtine/core';
import { calculateScores, eventTime } from '@newtine/batch/generation/generation.policy.js';
import {
  GENERATIONS,
  type GenerationConfig,
  type Catalog,
  type Draft,
  type GenerationResult,
} from '@newtine/batch/generation/generation.types.js';
import { rules, checkedReview, applyPatches } from '@newtine/batch/validation/validation.policy.js';
import { ValidationService } from '@newtine/batch/validation/validation.service.js';
import { ValidationOpenAiModel } from '@newtine/batch/validation/validation.model.js';
import type {
  ValidationRun,
  ValidationSnapshot,
  ValidationStore,
  ValidationModel,
} from '@newtine/batch/validation/validation.types.js';
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

function snapshot(): ValidationSnapshot {
  const r = result();
  r.articles = structuredClone(articles);
  r.draft = draft();
  r.status = 'GENERATED';
  r.classification = { topics: ['housing'], regions: ['seoul'], entities: [], generations: [] };
  r.glossary = [
    { term: '보증금', definition: '계약을 보증하려고 맡기는 돈이에요.', source: 'GENERATED' },
  ];
  Object.assign(r, eventTime(r.draft, r.articles, at.toISOString(), r.source.selectedArticles));
  r.scores = calculateScores(r, at.toISOString(), config);
  return {
    at: at.toISOString(),
    generationAt: at.toISOString(),
    config,
    catalog,
    results: [{ original: structuredClone(r), current: r, reviews: [] }],
    usage: [],
  };
}
class Store implements ValidationStore {
  run: ValidationRun = {
    id: 'run',
    generationRunId: 'source',
    owner: 'owner',
    completed: false,
    snapshot: snapshot(),
  };
  failed = false;
  async claim() {
    return structuredClone(this.run);
  }
  async save(run: ValidationRun) {
    this.run = structuredClone(run);
  }
  async heartbeat() {}
  async complete(run: ValidationRun) {
    run.completed = true;
    await this.save(run);
  }
  async fail() {
    this.failed = true;
  }
}
function model(overrides: Partial<ValidationModel> = {}): ValidationModel {
  return {
    usage: [],
    review: async () => ({ findings: [] }),
    repair: async () => [],
    ...overrides,
  };
}
test('valid content passes without requiring independent evidence groups', async () => {
  const store = new Store();
  assert.equal(rules(store.run.snapshot.results[0]!.current, store.run.snapshot).length, 0);
  const run = await new ValidationService(store, model()).execute('source');
  assert.equal(run.snapshot.results[0]!.status, 'PASSED');
  const again = await new ValidationService(
    store,
    model({
      review: async () => {
        throw new Error('MUST_NOT_CALL');
      },
    }),
  ).execute('source');
  assert.equal(again.completed, true);
});
test('rule failure bypasses initial semantic call and repairs only failed field', async () => {
  const store = new Store();
  const item = store.run.snapshot.results[0]!;
  item.current.draft!.title = '';
  item.original = structuredClone(item.current);
  let calls = 0;
  const run = await new ValidationService(
    store,
    model({
      review: async () => {
        calls++;
        return { findings: [] };
      },
      repair: async (_r, _f, fields) => {
        assert.equal(fields.join(','), 'title');
        return [{ field: 'title', value: '정부, 보증금 지원 발표' }];
      },
    }),
  ).execute('source');
  assert.equal(calls, 1);
  assert.equal(run.snapshot.results[0]!.status, 'PASSED');
  assert.equal(run.snapshot.results[0]!.original.draft!.title, '');
  assert.equal(
    run.snapshot.results[0]!.current.draft!.integratedSummary,
    item.current.draft!.integratedSummary,
  );
});
test('semantic failure repairs once and holds on repeated failure', async () => {
  const store = new Store();
  let repairs = 0;
  const run = await new ValidationService(
    store,
    model({
      review: async () => ({
        findings: [
          {
            field: 'title',
            category: 'FACT',
            reason: '제목에 근거 없는 단정',
            articleIds: [articles[0]!.articleId],
          },
        ],
      }),
      repair: async () => {
        repairs++;
        return [{ field: 'title', value: '정부 지원 발표' }];
      },
    }),
  ).execute('source');
  assert.equal(repairs, 1);
  assert.equal(run.snapshot.results[0]!.status, 'HELD');
  assert.equal(run.snapshot.results[0]!.reviews.length, 2);
});
test('invalid patch cannot mutate unrelated fields and is held', async () => {
  const store = new Store();
  const run = await new ValidationService(
    store,
    model({
      review: async () => ({
        findings: [{ field: 'title', category: 'UX', reason: '제목 수정', articleIds: [] }],
      }),
      repair: async () => [{ field: 'integratedSummary', value: '무단 수정' }],
    }),
  ).execute('source');
  const r = run.snapshot.results[0]!;
  assert.equal(r.status, 'HELD');
  assert.equal(r.repair!.error, 'INVALID_VALIDATION_PATCH');
  assert.equal(r.current.draft!.integratedSummary, r.original.draft!.integratedSummary);
});
test('wrong DB codes, references, scores and shared impacts fail rules', () => {
  for (const mutate of [
    (r: GenerationResult) => {
      r.classification!.topics = ['unknown'];
    },
    (r: GenerationResult) => {
      r.draft!.viewpoints[0]!.articleIds = ['unknown'];
    },
    (r: GenerationResult) => {
      r.scores!.importance = 1.1;
    },
    (r: GenerationResult) => {
      r.draft!.sharedConditionalImpact = {
        description: '대상자라면 지원받아요.',
        articleIds: [articles[0]!.articleId],
      };
    },
  ]) {
    const s = snapshot();
    mutate(s.results[0]!.current);
    assert.ok(rules(s.results[0]!.current, s).length);
  }
});
test('malformed repaired field is rejected by final rules', async () => {
  const store = new Store();
  store.run.snapshot.results[0]!.current.draft!.summaryLines = [];
  const run = await new ValidationService(
    store,
    model({ repair: async () => [{ field: 'summaryLines', value: null }] }),
  ).execute('source');
  assert.equal(run.snapshot.results[0]!.status, 'HELD');
});
test('failed final API call resumes without repeating successful repair', async () => {
  const store = new Store();
  let calls = 0,
    repairs = 0;
  const m = model({
    review: async () => {
      calls++;
      if (calls === 1)
        return { findings: [{ field: 'title', category: 'UX', reason: '수정', articleIds: [] }] };
      if (calls === 2) throw new Error('NETWORK');
      return { findings: [] };
    },
    repair: async () => {
      repairs++;
      return [{ field: 'title', value: '지원 발표' }];
    },
  });
  const service = new ValidationService(store, m);
  await assert.rejects(service.execute('source'), /NETWORK/);
  const run = await service.execute('source');
  assert.equal(repairs, 1);
  assert.equal(calls, 3);
  assert.equal(run.snapshot.results[0]!.status, 'PASSED');
});
test('review rejects invented references and patch rejects duplicate or unknown fields', () => {
  const s = snapshot(),
    r = s.results[0]!.current;
  assert.throws(() =>
    checkedReview(
      {
        findings: [
          { field: 'title', category: 'FACT', reason: '사실 오류', articleIds: ['invented'] },
        ],
      },
      r,
    ),
  );
  assert.throws(() =>
    applyPatches(
      r,
      [
        { field: 'title', value: 'a' },
        { field: 'title', value: 'b' },
      ],
      ['title'],
      s,
    ),
  );
});
test('model loads external review prompt, uses configured model and captures usage', async () => {
  let request: Record<string, unknown> = {};
  const m = new ValidationOpenAiModel('test', 'UX_GUIDE', (async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        status: 'completed',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 50 },
        },
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"findings":[]}' }] }],
      }),
    );
  }) as typeof fetch);
  const s = snapshot();
  await m.review(s.results[0]!.current, s);
  assert.equal(request.model, 'gpt-5.4-mini-2026-03-17');
  assert.ok(String(request.instructions).includes('UX_GUIDE'));
  assert.equal(m.usage[0]!.cachedInputTokens, 50);
});

test('dependent shared impact fields repair together and preserve unrelated fields', async () => {
  const store = new Store();
  let calls = 0;
  const shared = {
    description: '주거 지원 대상인 사람이라면 지원을 받을 수 있어요.',
    articleIds: [articles[0]!.articleId],
  };
  const run = await new ValidationService(
    store,
    model({
      review: async () =>
        ++calls === 1
          ? {
              findings: [
                {
                  field: 'sharedConditionalImpact',
                  category: 'CONSISTENCY',
                  reason: '공통 대상 조건 필요',
                  articleIds: [articles[0]!.articleId],
                },
              ],
            }
          : { findings: [] },
      repair: async (_r, _f, fields) => {
        assert.equal(fields.join(','), 'sharedConditionalImpact,impacts');
        return [
          { field: 'sharedConditionalImpact', value: shared },
          { field: 'impacts', value: GENERATIONS.map((generation) => ({ generation, ...shared })) },
        ];
      },
    }),
  ).execute('source');
  const r = run.snapshot.results[0]!;
  assert.equal(r.status, 'PASSED');
  assert.ok(r.current.draft!.impacts.every((i) => i.description === shared.description));
  assert.equal(r.current.draft!.title, r.original.draft!.title);
});
test('bad computed scores are recomputed without a repair LLM call', async () => {
  const store = new Store();
  store.run.snapshot.results[0]!.current.scores!.freshness = 2;
  const run = await new ValidationService(
    store,
    model({
      repair: async () => {
        throw new Error('MUST_NOT_CALL');
      },
    }),
  ).execute('source');
  assert.equal(run.snapshot.results[0]!.status, 'PASSED');
  assert.ok(run.snapshot.results[0]!.current.scores!.freshness <= 1);
});
