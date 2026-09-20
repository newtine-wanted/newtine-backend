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
class ToneValidationService extends ValidationService {
  constructor(store: ValidationStore, model: ValidationModel) {
    super(store, model, undefined, true);
  }
}
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
  const run = await new ToneValidationService(store, model()).execute('source');
  assert.equal(run.snapshot.results[0]!.status, 'PASSED');
  const again = await new ToneValidationService(
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
  const run = await new ToneValidationService(
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
  const run = await new ToneValidationService(
    store,
    model({
      review: async () => ({
        findings: [
          {
            field: 'title',
            category: 'TONE',
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
  const run = await new ToneValidationService(
    store,
    model({
      review: async () => ({
        findings: [{ field: 'title', category: 'TONE', reason: '제목 수정', articleIds: [] }],
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
  const run = await new ToneValidationService(
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
        return { findings: [{ field: 'title', category: 'TONE', reason: '수정', articleIds: [] }] };
      if (calls === 2) throw new Error('NETWORK');
      return { findings: [] };
    },
    repair: async () => {
      repairs++;
      return [{ field: 'title', value: '지원 발표' }];
    },
  });
  const service = new ToneValidationService(store, m);
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
          { field: 'title', category: 'TONE', reason: '과도한 비하', articleIds: ['invented'] },
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
  const m = new ValidationOpenAiModel('test', (async (_url, init) => {
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
  assert.ok(String(request.instructions).includes('공격적이거나 편향된'));
  const input = JSON.parse(String(request.input));
  assert.equal(input.articles, undefined);
  assert.equal(input.catalog, undefined);
  assert.equal(input.draft.llmEstimatedImportance, undefined);
  assert.equal(m.usage[0]!.cachedInputTokens, 50);
});

test('dependent shared impact fields repair together and preserve unrelated fields', async () => {
  const store = new Store();
  let calls = 0;
  const shared = {
    description: '주거 지원 대상인 사람이라면 지원을 받을 수 있어요.',
    articleIds: [articles[0]!.articleId],
  };
  const run = await new ToneValidationService(
    store,
    model({
      review: async () =>
        ++calls === 1
          ? {
              findings: [
                {
                  field: 'sharedConditionalImpact',
                  category: 'TONE',
                  reason: '공통 영향의 비하 표현 수정',
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
  const run = await new ToneValidationService(
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

test('FIRST_REPORT discards an unverified event proposal without failing or exposing it as fact', async () => {
  const s = snapshot(),
    r = s.results[0]!.current;
  r.draft!.eventAt = '2030-01-01T00:00:00Z';
  r.draft!.eventEvidence = '기사에 없는 시각';
  assert.equal(r.eventAtSource, 'FIRST_REPORT');
  assert.equal(rules(r, s).length, 0);
  let payload: { input?: string } = {};
  const m = new ValidationOpenAiModel('test', (async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"findings":[]}' }] }],
      }),
    );
  }) as typeof fetch);
  await m.review(r, s);
  const input = JSON.parse(payload.input!);
  assert.equal(input.draft.eventAt, undefined);
  assert.equal(input.draft.eventEvidence, undefined);
  assert.equal(input.eventTimeMode, undefined);
  assert.equal(input.computed, undefined);
  assert.equal(input.scores, undefined);
  assert.equal(r.draft!.eventAt, '2030-01-01T00:00:00Z');
});

test('review projects shared impact once and excludes computed-only fields from response schema', async () => {
  const s = snapshot(),
    r = s.results[0]!.current;
  r.draft!.sharedConditionalImpact = {
    description: '대상자라면 지원받아요.',
    articleIds: [articles[0]!.articleId],
  };
  r.draft!.impacts = GENERATIONS.map((generation) => ({
    generation,
    ...r.draft!.sharedConditionalImpact!,
  }));
  let payload: {
    input?: string;
    text?: {
      format: {
        schema: {
          properties: { findings: { items: { properties: { field: { enum: string[] } } } } };
        };
      };
    };
  } = {};
  const m = new ValidationOpenAiModel('test', (async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"findings":[]}' }] }],
      }),
    );
  }) as typeof fetch);
  await m.review(r, s);
  const input = JSON.parse(payload.input!);
  assert.equal(input.draft.impacts, undefined);
  assert.equal(input.draft.sharedConditionalImpact.description, '대상자라면 지원받아요.');
  const allowed = payload.text!.format.schema.properties.findings.items.properties.field.enum;
  for (const field of ['eventAt', 'eventEvidence', 'impacts', 'scores'])
    assert.ok(!allowed.includes(field));
  assert.equal(r.draft!.impacts.length, 4);
});

test('three-term cap updates existing results without another LLM call and preserves audit source', async () => {
  const store = new Store(),
    r = store.run.snapshot.results[0]!;
  r.current.draft!.terms = ['정부', '보증금', '지원', '발표'];
  r.current.glossary = r.current.draft!.terms.map((term) => ({
    term,
    definition: `${term} 설명`,
    source: 'GENERATED',
  }));
  r.original = structuredClone(r.current);
  r.status = 'PASSED';
  const run = await new ToneValidationService(
    store,
    model({
      review: async () => {
        throw new Error('MUST_NOT_CALL');
      },
    }),
  ).execute('source');
  const result = run.snapshot.results[0]!;
  assert.equal(result.current.draft!.terms.length, 3);
  assert.equal(result.current.glossary!.length, 3);
  assert.equal(result.original.draft!.terms.length, 4);
  assert.equal(result.termLimit!.removedTerms.join(','), '발표');
  assert.equal(rules(result.current, run.snapshot).length, 0);
});

for (const invalid of [false, true])
  test(`AI validation is disabled by default and rules still apply (invalid=${invalid})`, async () => {
    const store = new Store();
    if (invalid) store.run.snapshot.results[0]!.current.draft!.title = '';
    const forbidden = model({
      review: async () => {
        throw new Error('AI_MUST_NOT_RUN');
      },
      repair: async () => {
        throw new Error('AI_MUST_NOT_RUN');
      },
    });
    const run = await new ValidationService(store, forbidden).execute('source');
    assert.equal(run.snapshot.aiValidationEnabled, false);
    assert.equal(run.snapshot.results[0]!.status, invalid ? 'HELD' : 'PASSED');
    assert.equal(run.snapshot.results[0]!.repair, undefined);
    assert.equal(run.snapshot.results[0]!.reviews[0]!.semantic, undefined);
    assert.equal(run.snapshot.usage.length, 0);
  });

for (const finding of [
  { field: 'title', category: 'FACT' },
  { field: 'title', category: 'CONSISTENCY' },
  { field: 'title', category: 'UX' },
  { field: 'classification', category: 'TONE' },
  { field: 'source', category: 'TONE' },
]) {
  test(`tone review rejects out-of-scope findings: ${finding.category}/${finding.field}`, () => {
    assert.throws(
      () =>
        checkedReview(
          {
            findings: [
              {
                ...finding,
                reason: '범위 밖 판정',
                articleIds: [],
              },
            ],
          } as Parameters<typeof checkedReview>[0],
          snapshot().results[0]!.current,
        ),
      /INVALID_VALIDATION_REVIEW/,
    );
  });
}

test('validation flags only the overlong summary body for repair', () => {
  const s = snapshot();
  const r = s.results[0]!.current;
  r.draft!.integratedSummary =
    '정부가 보증금 지원을 발표했어요. 다음 달 시행해요. 대상은 추후 안내해요.';
  const findings = rules(r, s);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.field, 'integratedSummary');
  assert.equal(findings[0]!.category, 'RULE');
});
