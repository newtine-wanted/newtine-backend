import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import type { DiscoveredArticle } from '@newtine/core';
import { DiscoveryService } from '@newtine/batch/discovery/discovery.service.js';
import {
  filterArticles,
  parseDiscoveryConfig,
  seoulDay,
  validateGroups,
} from '@newtine/batch/discovery/discovery.policy.js';
import { DiscoveryOpenAiModel } from '@newtine/batch/discovery/discovery.model.js';
import type {
  DiscoveryConfig,
  DiscoveryModel,
  DiscoveryRun,
  DiscoveryStore,
  SearchQuery,
  TrackingIssue,
} from '@newtine/batch/discovery/discovery.types.js';

const at = new Date('2026-09-20T03:00:00Z');
const since = '2026-09-19T03:00:00.000Z';
const config: DiscoveryConfig = {
  articlesPerQuery: 50,
  candidatesPerQuery: 5,
  maxQueries: 300,
  maxCandidates: 1500,
  entityTypes: ['POLITICIAN', 'INSTITUTION', 'PARTY'],
};
const article = (
  title: string,
  url = 'https://example.com/1',
  publishedAt = '2026-09-20T01:00:00Z',
): DiscoveredArticle => ({
  title,
  sourceUrl: url,
  publisherName: 'test',
  publishedAt,
  description: 'DO_NOT_SEND_DESCRIPTION',
});
const query = (text = '정치'): SearchQuery => ({ text, since, origins: ['TOPIC:politics'] });
class Store implements DiscoveryStore {
  saved?: DiscoveryRun;
  failed = false;
  follow: TrackingIssue[] = [];
  catalogQueries = [query('정치'), query('국회')];
  async claim(): Promise<DiscoveryRun> {
    return structuredClone(
      this.saved ?? {
        id: 'run',
        day: '2026-09-20',
        owner: 'owner',
        completed: false,
        snapshot: { at: at.toISOString(), config, results: [], usage: [] },
      },
    );
  }
  async catalog(): Promise<SearchQuery[]> {
    return this.catalogQueries;
  }
  async tracks(): Promise<TrackingIssue[]> {
    return this.follow;
  }
  async save(run: DiscoveryRun): Promise<void> {
    this.saved = structuredClone(run);
  }
  async heartbeat(): Promise<void> {}
  async complete(run: DiscoveryRun): Promise<void> {
    run.completed = true;
    await this.save(run);
  }
  async fail(): Promise<void> {
    this.failed = true;
  }
}
function model(overrides: Partial<DiscoveryModel> = {}): DiscoveryModel {
  return {
    extract: async (titles) => [{ title: titles[0]!, titleIndexes: [0] }],
    groups: async (titles) => titles.map((_, i) => [i]),
    newDevelopments: async () => [0],
    ...overrides,
  };
}

test('50 latest articles are bounded by the 24h window and deduplicated by URL and normalized title', () => {
  const result = filterArticles(
    [
      article('A', 'https://example.com/a'),
      article('different', 'https://example.com/a#fragment'),
      article('  a  ', 'https://example.com/b'),
      article('old', 'https://example.com/old', '2026-09-19T02:59:59Z'),
      article('boundary', 'https://example.com/boundary', since),
      article('future', 'https://example.com/future', '2026-09-20T03:00:01Z'),
      { ...article('no date'), publishedAt: undefined },
      article('bad url', 'javascript:alert(1)'),
      ...Array.from({ length: 60 }, (_, i) => article(`article ${i}`, `https://example.com/${i}`)),
    ],
    query(),
    at.toISOString(),
    50,
  );
  assert.equal(result.length, 50);
  assert.deepEqual(
    result.slice(0, 2).map((a) => a.title),
    ['A', 'boundary'],
  );
  assert.equal(
    filterArticles(
      [article('boundary', 'https://example.com/a', since)],
      { ...query(), parentIssueId: 'parent' },
      at.toISOString(),
      50,
    ).length,
    0,
  );
  assert.equal(seoulDay(new Date('2026-09-19T15:00:00Z')), '2026-09-20');
});

test('each query sends titles only and global semantic merge preserves provenance and parents', async () => {
  const store = new Store();
  store.follow = [
    {
      issueId: 'parent',
      title: '원래 법안 발의',
      keywords: [],
      lastCheckedAt: since,
      expiresAt: '2026-09-21T00:00:00Z',
      knownTitles: [],
    },
  ];
  const calls: string[][] = [];
  const limits: number[] = [];
  const run = await new DiscoveryService(
    store,
    {
      search: async (q, limit) => {
        limits.push(limit);
        return [article(`${q} 통과`, `https://example.com/${encodeURIComponent(q)}`)];
      },
    },
    model({
      extract: async (titles) => {
        calls.push(titles);
        return [{ title: titles[0]!, titleIndexes: [0] }];
      },
      groups: async (titles) => [titles.map((_, i) => i)],
    }),
  ).execute(config, at);
  assert.equal(calls.length, 3);
  assert.ok(limits.every((n) => n === 50));
  assert.ok(calls.flat().every((t) => !t.includes('DO_NOT_SEND')));
  assert.equal(run.snapshot.candidates!.length, 1);
  assert.equal(run.snapshot.candidates![0]!.articles.length, 3);
  assert.deepEqual(run.snapshot.candidates![0]!.parentIssueIds, ['parent']);
  assert.ok(run.snapshot.candidates![0]!.origins.includes('TOPIC:politics'));
  assert.equal(run.snapshot.candidates![0]!.mergedCandidateIds.length, 3);
});

test('failed query resumes from last persisted success without repeating an earlier query', async () => {
  const store = new Store();
  const searches: string[] = [];
  let failed = false;
  const service = new DiscoveryService(
    store,
    {
      search: async (q) => {
        searches.push(q);
        if (q === '국회' && !failed) {
          failed = true;
          throw new Error('NETWORK');
        }
        return [article(q)];
      },
    },
    model(),
  );
  await assert.rejects(service.execute(config, at));
  assert.equal(store.failed, true);
  assert.equal(store.saved!.snapshot.results.length, 1);
  const result = await service.execute(config, at);
  assert.equal(result.completed, true);
  assert.deepEqual(searches, ['정치', '국회', '국회']);
  await service.execute(config, at);
  assert.equal(searches.length, 3);
});

test('unknown evidence indices, incomplete groups and query limits fail without completing', async () => {
  const store = new Store();
  store.catalogQueries = [query()];
  await assert.rejects(
    new DiscoveryService(
      store,
      { search: async () => [article('A')] },
      model({ extract: async () => [{ title: 'fake', titleIndexes: [99] }] }),
    ).execute(config, at),
    /INVALID_TITLE_INDEXES/,
  );
  assert.equal(store.saved?.completed, false);
  assert.throws(() => validateGroups([[0], [0]], 2));
  assert.throws(() => validateGroups([[0]], 2));
  assert.throws(() => parseDiscoveryConfig({ ...config, articlesPerQuery: 101 }));
  const limitedStore = new Store();
  limitedStore.claim = async () => ({
    id: 'limit',
    owner: 'owner',
    day: 'day',
    completed: false,
    snapshot: {
      at: at.toISOString(),
      config: { ...config, maxQueries: 1 },
      results: [],
      usage: [],
    },
  });
  await assert.rejects(
    new DiscoveryService(
      limitedStore,
      {
        search: async () => {
          throw new Error('SEARCH_MUST_NOT_RUN');
        },
      },
      model(),
    ).execute(config, at),
    /QUERY_LIMIT_EXCEEDED/,
  );
});

test('empty search results skip LLM and uncertain follow-ups are excluded', async () => {
  const store = new Store();
  store.catalogQueries = [];
  store.follow = [
    {
      issueId: 'parent',
      title: '법안 발의',
      keywords: [],
      lastCheckedAt: since,
      expiresAt: '2026-09-21T00:00:00Z',
      knownTitles: [],
    },
  ];
  const run = await new DiscoveryService(
    store,
    { search: async () => [article('법안 발의 재보도')] },
    model({ newDevelopments: async () => [] }),
  ).execute(config, at);
  assert.equal(run.snapshot.candidates!.length, 0);
  const empty = new Store();
  await new DiscoveryService(
    empty,
    { search: async () => [] },
    model({
      extract: async () => {
        throw new Error('MUST_NOT_CALL');
      },
    }),
  ).execute(config, at);
});

test('OpenAI request uses fixed model and only the title array as extraction input', async () => {
  let payload: Record<string, unknown> = {};
  const client = new DiscoveryOpenAiModel('test', (async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '{"candidates":[]}' }] },
        ],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
  }) as typeof fetch);
  await client.extract(['제목만 전송'], 5);
  assert.deepEqual(JSON.parse(String(payload.input)), ['제목만 전송']);
  assert.equal(payload.model, 'gpt-5.4-mini-2026-03-17');
  assert.equal(payload.store, false);
  assert.equal(client.usage[0]!.inputTokens, 1);
  const incomplete = new DiscoveryOpenAiModel(
    'test',
    (async () =>
      new Response(JSON.stringify({ status: 'incomplete', output: [] }))) as typeof fetch,
  );
  await assert.rejects(incomplete.extract(['제목'], 5), /INCOMPLETE/);
});

test('failed semantic validation records usage and preserves original query checkpoints', async () => {
  const store = new Store();
  const usage = [
    { stage: 'deduplicate', model: 'gpt-5.4-mini-2026-03-17', inputTokens: 10, outputTokens: 2 },
  ];
  const client = model({
    usage,
    groups: async () => {
      throw new Error('OPENAI_HTTP_429');
    },
  });
  const service = new DiscoveryService(store, { search: async (q) => [article(q)] }, client);
  await assert.rejects(service.execute(config, at), /OPENAI_HTTP_429/);
  assert.equal(store.saved!.snapshot.results.length, 2);
  assert.ok(store.saved!.snapshot.usage.some((u) => u.inputTokens === 10));
  assert.equal(store.saved!.completed, false);
});

test('semantic groups must cover every candidate once, and invalid output cannot complete', async () => {
  const store = new Store();
  await assert.rejects(
    new DiscoveryService(
      store,
      { search: async (q) => [article(q)] },
      model({ groups: async () => [[0]] }),
    ).execute(config, at),
    /INCOMPLETE_DUPLICATE_GROUPS/,
  );
  assert.equal(store.saved!.completed, false);
  assert.equal(store.saved!.snapshot.results.length, 2);
});

test('exact duplicates are merged before semantic comparison while retaining all sources', async () => {
  const store = new Store();
  const run = await new DiscoveryService(
    store,
    { search: async (q) => [article('동일 기사', `https://example.com/${encodeURIComponent(q)}`)] },
    model({
      groups: async () => {
        throw new Error('UNNECESSARY_LLM_CALL');
      },
    }),
  ).execute(config, at);
  assert.equal(run.snapshot.candidates!.length, 1);
  assert.equal(run.snapshot.candidates![0]!.articles.length, 1);
  assert.deepEqual(run.snapshot.candidates![0]!.queries, ['정치', '국회']);
});

test('abort after search does not call the LLM or advance the checkpoint', async () => {
  const store = new Store();
  const controller = new AbortController();
  await assert.rejects(
    new DiscoveryService(
      store,
      {
        search: async () => {
          controller.abort();
          return [article('뉴스')];
        },
      },
      model({
        extract: async () => {
          throw new Error('MUST_NOT_CALL');
        },
      }),
    ).execute(config, at, controller.signal),
  );
  assert.equal(store.saved!.snapshot.results.length, 0);
  assert.equal(store.failed, true);
});
