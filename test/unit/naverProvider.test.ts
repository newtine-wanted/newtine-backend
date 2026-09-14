import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  NaverArticleBodyProvider,
  NaverNewsProvider,
} from '@newtine/batch/pipeline/naverNews.provider.js';
import { PipelineException, PipelineExceptionCode, generateUuidV7 } from '@newtine/core';

test('Naver adapter translates missing credentials into a pipeline exception', async () => {
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

test('Naver search separates response body transport failures from malformed JSON', async () => {
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

test('Naver article adapter rejects redirects outside the Naver allowlist', async () => {
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

test('Naver article adapter follows only validated Naver redirects and caps the body', async () => {
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

test('Naver article adapter rejects an HTML response over the byte cap', async () => {
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
