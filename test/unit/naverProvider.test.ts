import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  NaverArticleBodyProvider,
  NaverNewsProvider,
} from '@newtine/batch/pipeline/naverNews.provider.js';
import { PipelineException, PipelineExceptionCode, generateUuidV7 } from '@newtine/core';

test('네이버 어댑터는 자격증명이 없으면 파이프라인 예외를 반환한다', async () => {
  const previousClientId = process.env.NAVER_CLIENT_ID;
  const previousClientSecret = process.env.NAVER_CLIENT_SECRET;
  delete process.env.NAVER_CLIENT_ID;
  delete process.env.NAVER_CLIENT_SECRET;

  try {
    await assert.rejects(
      () => new NaverNewsProvider().search('정책', 1),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.domain === 'pipeline' &&
        error.code === PipelineExceptionCode.UpstreamError &&
        error.retryable === false,
    );
  } finally {
    if (previousClientId === undefined) delete process.env.NAVER_CLIENT_ID;
    else process.env.NAVER_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.NAVER_CLIENT_SECRET;
    else process.env.NAVER_CLIENT_SECRET = previousClientSecret;
  }
});

test('네이버 검색은 응답 본문 전송 실패와 잘못된 JSON을 구분한다', async () => {
  const previousClientId = process.env.NAVER_CLIENT_ID;
  const previousClientSecret = process.env.NAVER_CLIENT_SECRET;
  const previousFetch = globalThis.fetch;
  process.env.NAVER_CLIENT_ID = 'test-client-id';
  process.env.NAVER_CLIENT_SECRET = 'test-client-secret';
  try {
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"items":'));
            controller.error(new Error('connection reset while reading response'));
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    await assert.rejects(
      () => new NaverNewsProvider().search('정책', 1),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.UpstreamError &&
        error.retryable === true &&
        error.resultUncertain === true,
    );

    globalThis.fetch = async () =>
      new Response('{"items":', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await assert.rejects(
      () => new NaverNewsProvider().search('정책', 1),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.InvalidOutput &&
        error.retryable === false &&
        error.resultUncertain === false,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousClientId === undefined) delete process.env.NAVER_CLIENT_ID;
    else process.env.NAVER_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.NAVER_CLIENT_SECRET;
    else process.env.NAVER_CLIENT_SECRET = previousClientSecret;
  }
});

test('네이버 기사 어댑터는 허용 목록 밖으로 리디렉션되면 거부한다', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/private-resource' },
    });
  };

  try {
    await assert.rejects(
      () =>
        new NaverArticleBodyProvider().fetch({
          id: generateUuidV7(),
          title: '기사',
          description: '',
          sourceUrl: 'https://news.naver.com/article/1',
          naverUrl: 'https://n.news.naver.com/article/1',
          publisherName: 'naver',
        }),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.SourceUnavailable,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('네이버 기사 어댑터는 검증된 네이버 리디렉션만 따르고 본문 크기를 제한한다', async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; redirect: RequestInit['redirect'] | undefined }> = [];
  const responses = [
    new Response(null, {
      status: 302,
      headers: { location: 'https://news.naver.com/article/1?redirected=1' },
    }),
    new Response('<article>' + '확인된 본문 '.repeat(80) + '</article>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  ];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), redirect: init?.redirect });
    const response = responses.shift();
    if (response === undefined) throw new Error('unexpected fetch');
    return response;
  };

  try {
    const result = await new NaverArticleBodyProvider().fetch({
      id: generateUuidV7(),
      title: '기사',
      description: '',
      sourceUrl: 'https://news.naver.com/article/1',
      naverUrl: 'https://n.news.naver.com/article/1',
      publisherName: 'naver',
    });
    assert.match(result.body, /확인된 본문/);
    assert.deepEqual(
      requests.map((request) => request.redirect),
      ['manual', 'manual'],
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('네이버 기사 어댑터는 크기 제한을 초과한 HTML 응답을 거부한다', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('x'.repeat(2 * 1024 * 1024 + 1), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });

  try {
    await assert.rejects(
      () =>
        new NaverArticleBodyProvider().fetch({
          id: generateUuidV7(),
          title: '기사',
          description: '',
          sourceUrl: 'https://news.naver.com/article/1',
          naverUrl: 'https://n.news.naver.com/article/1',
          publisherName: 'naver',
        }),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.SourceUnavailable,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('API HUB 검색은 새 계약을 전송하고 기사 매핑과 결과 제한을 유지한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousId = process.env.NAVER_CLIENT_ID;
  const previousSecret = process.env.NAVER_CLIENT_SECRET;
  process.env.NAVER_CLIENT_ID = 'hub-test-id';
  process.env.NAVER_CLIENT_SECRET = 'hub-test-secret';
  const displays: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://naverapihub.apigw.ntruss.com/search/v1/news');
    assert.equal(url.searchParams.get('query'), '국회 정책');
    assert.equal(url.searchParams.get('start'), '1');
    assert.equal(url.searchParams.get('sort'), 'date');
    assert.equal(url.searchParams.get('format'), 'json');
    displays.push(url.searchParams.get('display') ?? '');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-NCP-APIGW-API-KEY-ID'), 'hub-test-id');
    assert.equal(headers.get('X-NCP-APIGW-API-KEY'), 'hub-test-secret');
    assert.equal(headers.has('X-Naver-Client-Id'), false);
    assert.equal(headers.has('X-Naver-Client-Secret'), false);
    return Response.json({
      items: [
        {
          title: '<b>정책</b> 발표',
          description: '<b>요약</b>',
          originallink: 'https://www.example.com/news/1',
          link: 'https://n.news.naver.com/article/1',
          pubDate: 'Thu, 11 Jun 2026 18:34:00 +0900',
        },
        {
          title: '원문 대체',
          description: '',
          originallink: '',
          link: 'https://example.com/news/2',
          pubDate: 'invalid',
        },
        { title: '링크 없음' },
      ],
    });
  };
  try {
    const provider = new NaverNewsProvider();
    const articles = await provider.search('국회 정책', 500);
    await provider.search('국회 정책', 0);
    assert.deepEqual(displays, ['100', '1']);
    assert.equal(articles.length, 2);
    assert.equal(articles[0]?.title.trim(), '정책  발표');
    assert.equal(articles[0]?.description.trim(), '요약');
    assert.equal(articles[0]?.sourceUrl, 'https://www.example.com/news/1');
    assert.equal(articles[0]?.naverUrl, 'https://n.news.naver.com/article/1');
    assert.equal(articles[0]?.publisherName, 'example.com');
    assert.equal(articles[0]?.publishedAt, '2026-06-11T09:34:00.000Z');
    assert.equal(articles[1]?.sourceUrl, 'https://example.com/news/2');
    assert.equal(articles[1]?.publishedAt, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousId === undefined) delete process.env.NAVER_CLIENT_ID;
    else process.env.NAVER_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.NAVER_CLIENT_SECRET;
    else process.env.NAVER_CLIENT_SECRET = previousSecret;
  }
});

test('API HUB 검색은 요청 전에 없거나 공백인 자격증명을 거부한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousId = process.env.NAVER_CLIENT_ID;
  const previousSecret = process.env.NAVER_CLIENT_SECRET;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ items: [] });
  };
  try {
    for (const [id, secret] of [
      [undefined, 'secret'],
      ['id', undefined],
      ['', 'secret'],
      ['id', '  '],
    ]) {
      if (id === undefined) delete process.env.NAVER_CLIENT_ID;
      else process.env.NAVER_CLIENT_ID = id;
      if (secret === undefined) delete process.env.NAVER_CLIENT_SECRET;
      else process.env.NAVER_CLIENT_SECRET = secret;
      await assert.rejects(
        () => new NaverNewsProvider().search('국회', 10),
        (error: unknown) => error instanceof PipelineException && !error.retryable,
      );
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousId === undefined) delete process.env.NAVER_CLIENT_ID;
    else process.env.NAVER_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.NAVER_CLIENT_SECRET;
    else process.env.NAVER_CLIENT_SECRET = previousSecret;
  }
});

test('API HUB 검색은 fallback 요청 없이 HTTP 오류를 기존 기준으로 분류한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousId = process.env.NAVER_CLIENT_ID;
  const previousSecret = process.env.NAVER_CLIENT_SECRET;
  process.env.NAVER_CLIENT_ID = 'hub-test-id';
  process.env.NAVER_CLIENT_SECRET = 'hub-test-secret';
  try {
    for (const status of [401, 403, 429, 500, 503]) {
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        return new Response(null, { status });
      };
      const retryable = status === 429 || status >= 500;
      await assert.rejects(
        () => new NaverNewsProvider().search('국회', 10),
        (error: unknown) =>
          error instanceof PipelineException &&
          error.retryable === retryable &&
          error.code ===
            (retryable
              ? PipelineExceptionCode.UpstreamError
              : PipelineExceptionCode.SourceUnavailable),
      );
      assert.equal(requests, 1);
    }
    globalThis.fetch = async () => Response.json({ items: {} });
    await assert.rejects(
      () => new NaverNewsProvider().search('국회', 10),
      (error: unknown) =>
        error instanceof PipelineException && error.code === PipelineExceptionCode.InvalidOutput,
    );
    globalThis.fetch = async () => {
      throw new TypeError('network failure');
    };
    await assert.rejects(
      () => new NaverNewsProvider().search('국회', 10),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.UpstreamError &&
        error.retryable === true,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousId === undefined) delete process.env.NAVER_CLIENT_ID;
    else process.env.NAVER_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.NAVER_CLIENT_SECRET;
    else process.env.NAVER_CLIENT_SECRET = previousSecret;
  }
});
