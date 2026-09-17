import assert from 'node:assert/strict';
import { jest, test } from '@jest/globals';

import {
  buildPinnedArticleRequestOptions,
  NaverArticleBodyProvider,
  NaverNewsProvider,
  naverArticleNetwork,
} from '@newtine/batch/pipeline/naverNews.provider.js';
import {
  PipelineException,
  pipelineExternalException,
  PipelineExceptionCode,
  generateUuidV7,
} from '@newtine/core';

const EXTERNAL_ARTICLE_URL = 'https://8.8.8.8/news/1';
const EXTERNAL_REDIRECT_URL = 'https://1.1.1.1/news/1';

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

test('기사 어댑터는 사설 IP로 리디렉션되면 거부한다', async () => {
  const previousRequest = naverArticleNetwork.request;
  let calls = 0;
  naverArticleNetwork.request = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private-resource' },
    });
  };

  try {
    await assert.rejects(
      () =>
        new NaverArticleBodyProvider().fetch({
          id: generateUuidV7(),
          title: '기사',
          description: '',
          sourceUrl: EXTERNAL_ARTICLE_URL,
          naverUrl: 'https://n.news.naver.com/article/1',
          publisherName: 'naver',
        }),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.SourceUnavailable,
    );
    assert.equal(calls, 1);
  } finally {
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 공개 IP 리디렉션만 따르고 본문 크기를 제한한다', async () => {
  const previousRequest = naverArticleNetwork.request;
  const requests: Array<{ url: string; redirect: RequestInit['redirect'] | undefined }> = [];
  const responses = [
    new Response(null, {
      status: 302,
      headers: { location: `${EXTERNAL_REDIRECT_URL}?redirected=1` },
    }),
    new Response('<article>' + '확인된 본문 '.repeat(80) + '</article>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  ];
  naverArticleNetwork.request = async (url, init) => {
    requests.push({ url: url.toString(), redirect: init.redirect });
    const response = responses.shift();
    if (response === undefined) throw new Error('unexpected fetch');
    return response;
  };

  try {
    const result = await new NaverArticleBodyProvider().fetch({
      id: generateUuidV7(),
      title: '기사',
      description: '',
      sourceUrl: EXTERNAL_ARTICLE_URL,
      naverUrl: 'http://127.0.0.1/article/1',
      publisherName: 'external-publisher.example',
    });
    assert.match(result.body, /확인된 본문/);
    assert.deepEqual(
      requests.map((request) => request.redirect),
      ['manual', 'manual'],
    );
  } finally {
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 크기 제한을 초과한 HTML 응답을 거부한다', async () => {
  const previousRequest = naverArticleNetwork.request;
  naverArticleNetwork.request = async () =>
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
          sourceUrl: EXTERNAL_ARTICLE_URL,
          naverUrl: 'https://n.news.naver.com/article/1',
          publisherName: 'naver',
        }),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.SourceUnavailable,
    );
  } finally {
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 초기 사설 IP와 비표준 포트를 요청하지 않는다', async () => {
  const previousRequest = naverArticleNetwork.request;
  let calls = 0;
  naverArticleNetwork.request = async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  };

  try {
    for (const sourceUrl of ['http://127.0.0.1/article/1', 'https://8.8.8.8:8443/article/1']) {
      await assert.rejects(
        () =>
          new NaverArticleBodyProvider().fetch({
            id: generateUuidV7(),
            title: '기사',
            description: '',
            sourceUrl,
            naverUrl: EXTERNAL_ARTICLE_URL,
            publisherName: 'external-publisher.example',
          }),
        (error: unknown) =>
          error instanceof PipelineException &&
          error.code === PipelineExceptionCode.SourceUnavailable,
      );
    }
    assert.equal(calls, 0);
  } finally {
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 중첩된 정적 article 본문을 추출하고 주변 내비게이션을 제외한다', async () => {
  const previousRequest = naverArticleNetwork.request;
  naverArticleNetwork.request = async () =>
    new Response(
      `<html><body>
        <nav>메뉴와 추천 기사</nav>
        <article><div><p>첫 번째 문단입니다.</p><div><p>${'본문 근거 문장입니다. '.repeat(30)}</p></div></div></article>
      </body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );

  try {
    const result = await new NaverArticleBodyProvider().fetch({
      id: generateUuidV7(),
      title: '기사',
      description: '',
      sourceUrl: EXTERNAL_ARTICLE_URL,
      naverUrl: 'http://127.0.0.1/article/1',
      publisherName: 'external-publisher.example',
    });
    assert.match(result.body, /첫 번째 문단입니다/);
    assert.match(result.body, /본문 근거 문장입니다/);
    assert.doesNotMatch(result.body, /메뉴와 추천 기사/);
  } finally {
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 DNS에서 검증한 주소를 실제 transport에 전달한다', async () => {
  const previousResolve = naverArticleNetwork.resolve;
  const previousRequest = naverArticleNetwork.request;
  let requestedAddress: { address: string; family: number } | undefined;
  naverArticleNetwork.resolve = async () => [{ address: '93.184.216.34', family: 4 }];
  naverArticleNetwork.request = async (_url, _init, address) => {
    requestedAddress = address;
    return new Response(`<article>${'검증된 본문입니다. '.repeat(30)}</article>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };

  try {
    await new NaverArticleBodyProvider().fetch({
      id: generateUuidV7(),
      title: '기사',
      description: '',
      sourceUrl: 'https://publisher.example/news/1',
      naverUrl: EXTERNAL_ARTICLE_URL,
      publisherName: 'publisher.example',
    });
    assert.deepEqual(requestedAddress, { address: '93.184.216.34', family: 4 });
  } finally {
    naverArticleNetwork.resolve = previousResolve;
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 첫 public 주소 연결 실패 시 다음 주소를 시도한다', async () => {
  const previousResolve = naverArticleNetwork.resolve;
  const previousRequest = naverArticleNetwork.request;
  const requestedAddresses: string[] = [];
  naverArticleNetwork.resolve = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '93.184.216.35', family: 4 },
  ];
  naverArticleNetwork.request = async (_url, _init, address) => {
    requestedAddresses.push(address.address);
    if (address.address === '93.184.216.34') {
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
        retryable: true,
        resultUncertain: true,
      });
    }
    return new Response(`<article>${'두 번째 주소 본문입니다. '.repeat(30)}</article>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };

  try {
    await new NaverArticleBodyProvider().fetch({
      id: generateUuidV7(),
      title: '기사',
      description: '',
      sourceUrl: 'https://publisher.example/news/1',
      naverUrl: EXTERNAL_ARTICLE_URL,
      publisherName: 'publisher.example',
    });
    assert.deepEqual(requestedAddresses, ['93.184.216.34', '93.184.216.35']);
  } finally {
    naverArticleNetwork.resolve = previousResolve;
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 DNS 결과에 private 주소가 섞이면 연결하지 않는다', async () => {
  const previousResolve = naverArticleNetwork.resolve;
  const previousRequest = naverArticleNetwork.request;
  let calls = 0;
  naverArticleNetwork.resolve = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ];
  naverArticleNetwork.request = async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  };

  try {
    await assert.rejects(
      () =>
        new NaverArticleBodyProvider().fetch({
          id: generateUuidV7(),
          title: '기사',
          description: '',
          sourceUrl: 'https://publisher.example/news/1',
          naverUrl: EXTERNAL_ARTICLE_URL,
          publisherName: 'publisher.example',
        }),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.SourceUnavailable,
    );
    assert.equal(calls, 0);
  } finally {
    naverArticleNetwork.resolve = previousResolve;
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 IPv6 site-local과 benchmarking 대역을 거부한다', async () => {
  const previousRequest = naverArticleNetwork.request;
  let calls = 0;
  naverArticleNetwork.request = async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  };

  try {
    for (const sourceUrl of ['https://[fec0::1]/article/1', 'https://[2001:2::1]/article/1']) {
      await assert.rejects(
        () =>
          new NaverArticleBodyProvider().fetch({
            id: generateUuidV7(),
            title: '기사',
            description: '',
            sourceUrl,
            naverUrl: EXTERNAL_ARTICLE_URL,
            publisherName: 'external-publisher.example',
          }),
        (error: unknown) =>
          error instanceof PipelineException &&
          error.code === PipelineExceptionCode.SourceUnavailable,
      );
    }
    assert.equal(calls, 0);
  } finally {
    naverArticleNetwork.request = previousRequest;
  }
});

test('기사 어댑터는 DNS lookup timeout을 retryable upstream failure로 분류한다', async () => {
  const previousResolve = naverArticleNetwork.resolve;
  naverArticleNetwork.resolve = async () => new Promise<never>(() => undefined);
  jest.useFakeTimers();

  try {
    const pending = assert.rejects(
      () =>
        new NaverArticleBodyProvider().fetch({
          id: generateUuidV7(),
          title: '기사',
          description: '',
          sourceUrl: 'https://publisher.example/news/1',
          naverUrl: EXTERNAL_ARTICLE_URL,
          publisherName: 'publisher.example',
        }),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.code === PipelineExceptionCode.UpstreamError &&
        error.retryable === true,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await pending;
  } finally {
    jest.useRealTimers();
    naverArticleNetwork.resolve = previousResolve;
  }
});

test('pinned transport는 resolved IP와 원래 Host/SNI를 분리한다', () => {
  const options = buildPinnedArticleRequestOptions(
    new URL('https://publisher.test/article/1?from=naver'),
    { headers: { accept: 'text/html' } },
    { address: '93.184.216.34', family: 4 },
  );

  assert.equal(options.hostname, '93.184.216.34');
  assert.equal(options.headers.host, 'publisher.test');
  assert.equal(options.servername, 'publisher.test');
  assert.equal(options.path, '/article/1?from=naver');
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
