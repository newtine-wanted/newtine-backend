import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import type { DiscoveredArticle } from '@newtine/core';
import { CollectionService } from '@newtine/batch/collection/collection.service.js';
import { CollectionOpenAiModel } from '@newtine/batch/collection/collection.model.js';
import {
  parseCollectionConfig,
  publisherPriority,
  selectArticles,
} from '@newtine/batch/collection/collection.policy.js';
import type {
  CollectionConfig,
  CollectionModel,
  CollectionRun,
  CollectionStore,
  SimilarIssue,
} from '@newtine/batch/collection/collection.types.js';
import type { Candidate } from '@newtine/batch/discovery/discovery.types.js';

const at = new Date('2026-09-20T03:00:00Z');
const config: CollectionConfig = {
  articlesPerQuery: 50,
  publishers: [
    { name: '방송', domains: ['kbs.co.kr'], priority: 10 },
    { name: '통신', domains: ['yna.co.kr'], priority: 10 },
  ],
};
const article = (
  index: number,
  domain = 'other.com',
  publishedAt = '2026-09-20T02:00:00Z',
): DiscoveredArticle => ({
  title: `법안 통과 보도 ${index}`,
  description: '검색 요약',
  sourceUrl: `https://${domain}/${index}`,
  publisherName: 'untrusted label',
  publishedAt,
});
const candidate = (title = '법안 통과'): Candidate => ({
  id: title,
  title,
  articles: [article(0)],
  queries: ['국회'],
  origins: ['TOPIC:politics'],
  parentIssueIds: ['parent'],
  mergedCandidateIds: [title],
});
class Store implements CollectionStore {
  saved?: CollectionRun;
  issues: SimilarIssue[] = [{ id: 'existing', title: '법안 발의', similarity: 0.3 }];
  similarCalls = 0;
  failed = false;
  constructor(private readonly candidates = [candidate()]) {}
  async claim(): Promise<CollectionRun> {
    return structuredClone(
      this.saved ?? {
        id: 'run',
        discoveryRunId: 'source',
        owner: 'owner',
        completed: false,
        snapshot: {
          at: at.toISOString(),
          config,
          results: this.candidates.map((c) => ({ candidate: c })),
          usage: [],
        },
      },
    );
  }
  async similar(): Promise<SimilarIssue[]> {
    this.similarCalls++;
    return this.issues;
  }
  async save(run: CollectionRun): Promise<void> {
    this.saved = structuredClone(run);
  }
  async heartbeat(): Promise<void> {}
  async complete(run: CollectionRun): Promise<void> {
    run.completed = true;
    await this.save(run);
  }
  async fail(): Promise<void> {
    this.failed = true;
  }
}
const model = (): CollectionModel => ({
  duplicates: async () => [],
  relevant: async (_c, a) => a.map((_, i) => i),
});

test('collection config validates limits, domain syntax and duplicate entries', () => {
  assert.equal(JSON.stringify(parseCollectionConfig(config)), JSON.stringify(config));
  assert.throws(() => parseCollectionConfig({ ...config, articlesPerQuery: 51 }));
  for (const domains of [['https://kbs.co.kr'], ['kbs.co.kr', 'kbs.co.kr'], ['KBS.CO.KR']])
    assert.throws(() =>
      parseCollectionConfig({ ...config, publishers: [{ name: 'a', domains, priority: 10 }] }),
    );
  assert.throws(() =>
    parseCollectionConfig({
      ...config,
      publishers: [{ name: 'a', domains: ['kbs.co.kr'], priority: -1 }],
    }),
  );
});
test('publisher matching uses actual domain boundaries, not labels or path', () => {
  assert.equal(publisherPriority(article(1, 'news.kbs.co.kr'), config), 10);
  for (const host of ['fakekbs.co.kr', 'kbs.co.kr.evil.com', 'evil.com/kbs.co.kr'])
    assert.equal(publisherPriority(article(1, host), config), Infinity);
});
test('selection ranks known publishers, then latest, caps five and keeps unknown fallback', () => {
  const articles = Array.from({ length: 7 }, (_, i) => article(i));
  articles[5] = article(5, 'news.kbs.co.kr', '2026-09-20T00:00:00Z');
  articles[6] = article(6, 'yna.co.kr', '2026-09-20T01:00:00Z');
  const selected = selectArticles(articles, config);
  assert.equal(selected.length, 5);
  assert.deepEqual(selected.slice(0, 2), [articles[6], articles[5]]);
  assert.equal(selectArticles([article(1)], config).length, 1);
});
test('duplicate is persisted and skips news search; repeated completed run does no work', async () => {
  const store = new Store();
  const m = model();
  m.duplicates = async () => [0];
  const service = new CollectionService(
    store,
    {
      search: async () => {
        throw new Error('UNEXPECTED_SEARCH');
      },
    },
    m,
  );
  const run = await service.execute('source', config, at);
  assert.equal(run.snapshot.results[0]!.status, 'DUPLICATE');
  assert.deepEqual(run.snapshot.results[0]!.duplicateIssueIds, ['existing']);
  await service.execute('source', config, at);
  assert.equal(store.similarCalls, 1);
});
test('new development survives duplicate check; filters dates, URL/title duplicates and irrelevant results before ranking', async () => {
  const store = new Store();
  const m = model();
  let count = 0;
  m.relevant = async (_c, a) => {
    count = a.length;
    return a.map((_, i) => i).filter((i) => a[i]!.title !== '무관한 기사');
  };
  const articles = Array.from({ length: 8 }, (_, i) => article(i));
  articles[0] = { ...article(0, 'kbs.co.kr'), title: '무관한 기사' };
  articles[7] = article(7, 'yna.co.kr');
  const run = await new CollectionService(
    store,
    {
      search: async (q, limit) => {
        assert.equal(q, '법안 통과');
        assert.equal(limit, 50);
        return [
          ...articles,
          article(8, 'x.com', '2026-09-12T00:00:00Z'),
          article(9, 'x.com', '2026-09-21T00:00:00Z'),
          articles[1]!,
          { ...articles[2]!, sourceUrl: 'https://another.com/2' },
        ];
      },
    },
    m,
  ).execute('source', config, at);
  const result = run.snapshot.results[0]!;
  assert.equal(count, 8);
  assert.equal(result.status, 'SELECTED');
  assert.equal(result.selectedArticles!.length, 5);
  assert.equal(result.selectedArticles![0]!.sourceUrl, articles[7]!.sourceUrl);
  assert.deepEqual([...result.candidate.parentIssueIds], ['parent']);
});
for (const count of [0, 1])
  test(`drops candidate with ${count} relevant articles`, async () => {
    const store = new Store();
    const m = model();
    m.relevant = async () => Array.from({ length: count }, (_, i) => i);
    const run = await new CollectionService(
      store,
      { search: async () => [article(1), article(2)] },
      m,
    ).execute('source', config, at);
    assert.equal(run.snapshot.results[0]!.status, 'INSUFFICIENT_ARTICLES');
    assert.deepEqual(run.snapshot.results[0]!.selectedArticles, []);
  });
test('empty search and no existing issues skip model calls', async () => {
  const store = new Store();
  store.issues = [];
  const fail = async (): Promise<number[]> => {
    throw new Error('UNEXPECTED_MODEL');
  };
  const run = await new CollectionService(
    store,
    { search: async () => [] },
    { duplicates: fail, relevant: fail },
  ).execute('source', config, at);
  assert.equal(run.snapshot.results[0]!.status, 'INSUFFICIENT_ARTICLES');
});
test('relevance failure resumes from saved search and original configuration/time; preserves failed call usage', async () => {
  const store = new Store();
  const m = model();
  let searches = 0;
  let duplicates = 0;
  let fail = true;
  m.usage = [];
  m.duplicates = async () => {
    duplicates++;
    return [];
  };
  m.relevant = async () => {
    m.usage!.push({ stage: 'relevant', model: 'test', inputTokens: 10 });
    if (fail) {
      fail = false;
      throw new Error('MODEL_FAILED');
    }
    return [0, 1];
  };
  const service = new CollectionService(
    store,
    {
      search: async () => {
        searches++;
        return [article(1), article(2)];
      },
    },
    m,
  );
  await assert.rejects(service.execute('source', config, at), /MODEL_FAILED/);
  assert.equal(store.failed, true);
  const run = await service.execute(
    'source',
    { ...config, articlesPerQuery: 1 },
    new Date('2026-10-01'),
  );
  assert.equal(searches, 1);
  assert.equal(duplicates, 1);
  assert.equal(run.snapshot.config.articlesPerQuery, 50);
  assert.equal(run.snapshot.at, at.toISOString());
  assert.equal(run.snapshot.usage.length, 2);
  assert.equal(run.snapshot.results[0]!.status, 'SELECTED');
});
test('invalid duplicate/relevance indices fail rather than silently selecting wrong articles', async () => {
  for (const phase of ['duplicates', 'relevant'] as const) {
    const store = new Store();
    const m = model();
    m[phase] = async () => [99];
    await assert.rejects(
      new CollectionService(store, { search: async () => [article(1)] }, m).execute(
        'source',
        config,
        at,
      ),
      /INVALID_TITLE_INDEXES/,
    );
    assert.equal(store.saved!.snapshot.results[0]!.status, undefined);
  }
});
test('abort checkpoints without starting external work', async () => {
  const store = new Store();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new CollectionService(
      store,
      {
        search: async () => {
          throw new Error('UNEXPECTED');
        },
      },
      model(),
    ).execute('source', config, at, controller.signal),
  );
  assert.equal(store.similarCalls, 0);
});
test('model uses strict bounded indices and sends no source URLs or publisher priority to LLM', async () => {
  const requests: Record<string, unknown>[] = [];
  const request: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"indices":[0]}' }] }],
        usage: { input_tokens: 12, output_tokens: 4 },
      }),
    );
  };
  const m = new CollectionOpenAiModel('key', request);
  assert.deepEqual(
    await m.duplicates(candidate(), [{ id: 'x', title: '법안 통과', similarity: 1 }]),
    [0],
  );
  assert.deepEqual(await m.relevant(candidate(), [article(1)]), [0]);
  for (const body of requests) {
    assert.equal(body.model, 'gpt-5.4-mini-2026-03-17');
    assert.ok(!String(body.input).includes('https://'));
    assert.ok(!String(body.input).includes('untrusted label'));
  }
  assert.equal(m.usage.length, 2);
});
test('model refuses malformed, refused and incomplete output', async () => {
  for (const body of [
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] },
    {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"indices":[-1]}' }] }],
    },
  ]) {
    const m = new CollectionOpenAiModel('key', async () => new Response(JSON.stringify(body)));
    await assert.rejects(m.relevant(candidate(), [article(1)]));
  }
});

test('model normalizes repeated valid references but still rejects out-of-range indices', async () => {
  for (const indices of [
    [0, 0, 1, 1],
    [0, 2, 2],
  ]) {
    const m = new CollectionOpenAiModel(
      'key',
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: JSON.stringify({ indices }) }],
              },
            ],
          }),
        ),
    );
    if (indices.includes(2))
      await assert.rejects(
        m.relevant(candidate(), [article(0), article(1)]),
        /INVALID_TITLE_INDEXES/,
      );
    else assert.deepEqual(await m.relevant(candidate(), [article(0), article(1)]), [0, 1]);
  }
});

test('collection accepts last seven days including boundary, excludes older and future articles', async () => {
  const store = new Store();
  const times = [
    '2026-09-20T03:00:00Z',
    '2026-09-18T03:00:00Z',
    '2026-09-13T03:00:00Z',
    '2026-09-13T02:59:59Z',
    '2026-09-20T03:00:01Z',
  ];
  const run = await new CollectionService(
    store,
    { search: async () => times.map((t, i) => article(i, 'example.com', t)) },
    model(),
  ).execute('source', config, at);
  const result = run.snapshot.results[0]!;
  assert.equal(result.articles!.length, 3);
  assert.equal(result.selectedArticles!.length, 3);
  assert.deepEqual(
    result.articles!.map((a) => a.publishedAt),
    times.slice(0, 3),
  );
});

test('relevance receives only the explicit representative title, with first evidence fallback for legacy candidates', async () => {
  const inputs: { representativeArticleTitle: string; evidenceTitles?: string[] }[] = [];
  const m = new CollectionOpenAiModel('key', async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string };
    inputs.push(JSON.parse(body.input));
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"indices":[0]}' }] }],
      }),
    );
  });
  const c = candidate();
  c.representativeArticle = { ...article(2), title: '대표 사건 기사' };
  await m.relevant(c, [article(3)]);
  await m.relevant(candidate(), [article(3)]);
  assert.equal(inputs[0]!.representativeArticleTitle, '대표 사건 기사');
  assert.equal(inputs[0]!.evidenceTitles, undefined);
  assert.equal(inputs[1]!.representativeArticleTitle, candidate().articles[0]!.title);
  await assert.rejects(
    m.relevant({ ...candidate(), articles: [] }, [article(3)]),
    /REPRESENTATIVE_ARTICLE_REQUIRED/,
  );
});
