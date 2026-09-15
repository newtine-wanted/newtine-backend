import { Injectable } from '@nestjs/common';

import {
  PipelineException,
  pipelineExternalException,
  PipelineExceptionCode,
  type ArticleBodyProvider,
  type DiscoveredArticle,
  type NewsSearchProvider,
} from '@newtine/core';

const NAVER_SEARCH_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/news';
const NAVER_ARTICLE_HOSTS = new Set([
  'news.naver.com',
  'n.news.naver.com',
  'm.news.naver.com',
  'newsstand.naver.com',
]);
const MAX_ARTICLE_REDIRECT_HOPS = 3;
const MAX_ARTICLE_BODY_BYTES = 2 * 1024 * 1024;

@Injectable()
export class NaverNewsProvider implements NewsSearchProvider {
  async search(query: string, limit: number): Promise<DiscoveredArticle[]> {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (
      clientId === undefined ||
      clientSecret === undefined ||
      clientId.trim().length === 0 ||
      clientSecret.trim().length === 0
    )
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError);

    const url = new URL(NAVER_SEARCH_URL);
    url.searchParams.set('query', query);
    url.searchParams.set('display', String(Math.min(100, Math.max(1, limit))));
    url.searchParams.set('start', '1');
    url.searchParams.set('sort', 'date');
    url.searchParams.set('format', 'json');

    const response = await fetchOnce(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw pipelineExternalException(
        retryable ? PipelineExceptionCode.UpstreamError : PipelineExceptionCode.SourceUnavailable,
        { retryable },
      );
    }

    const body = await readJsonBody(response);
    if (!isRecord(body) || !Array.isArray(body.items))
      throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
    return body.items.flatMap((item) => toArticle(item));
  }
}

@Injectable()
export class NaverArticleBodyProvider implements ArticleBodyProvider {
  async fetch(article: DiscoveredArticle) {
    const sourceUrl = article.naverUrl ?? article.sourceUrl;
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    }
    if (!isAllowedNaverUrl(url))
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    const response = await fetchNaverArticle(
      url,
      {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'newtine-content-pipeline/1.0',
        },
      },
      15_000,
    );
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw pipelineExternalException(
        retryable ? PipelineExceptionCode.UpstreamError : PipelineExceptionCode.SourceUnavailable,
        { retryable },
      );
    }
    if (!isHtmlContentType(response.headers.get('content-type')))
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    let html: string;
    try {
      html = await readResponseText(response, MAX_ARTICLE_BODY_BYTES);
    } catch (error: unknown) {
      if (error instanceof PipelineException) throw error;
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
        retryable: true,
        resultUncertain: true,
        cause: error,
      });
    }
    const body = decodeEntities(extractText(html));
    if (body.length < 200 || article.id === undefined)
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    return {
      articleId: article.id,
      title: article.title,
      sourceUrl: article.sourceUrl,
      publisherName: article.publisherName,
      publishedAt: article.publishedAt,
      body,
    };
  }
}

async function fetchOnce(url: URL, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error: unknown) {
    throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
      retryable: true,
      resultUncertain: true,
      cause: error,
    });
  }
}

async function fetchNaverArticle(
  initialUrl: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let currentUrl = new URL(initialUrl.toString());
  for (let hop = 0; ; hop += 1) {
    if (!isAllowedNaverUrl(currentUrl))
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    const response = await fetchOnce(currentUrl, { ...init, redirect: 'manual' }, timeoutMs);
    if (!isRedirectStatus(response.status)) return response;
    if (hop >= MAX_ARTICLE_REDIRECT_HOPS) {
      await response.body?.cancel();
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    }
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (location === null || location.trim().length === 0)
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    try {
      currentUrl = new URL(location, currentUrl);
    } catch {
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    }
  }
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maxBytes)
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
  }
  if (response.body === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes)
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        return text;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function isAllowedNaverUrl(url: URL): boolean {
  const defaultPort = url.protocol === 'http:' ? '80' : '443';
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    (url.port === '' || url.port === defaultPort) &&
    url.username === '' &&
    url.password === '' &&
    NAVER_ARTICLE_HOSTS.has(url.hostname.toLowerCase())
  );
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isHtmlContentType(value: string | null): boolean {
  if (value === null) return false;
  const contentType = value.split(';', 1)[0]?.trim().toLowerCase();
  return contentType === 'text/html' || contentType === 'application/xhtml+xml';
}

function toArticle(value: unknown): DiscoveredArticle[] {
  if (!isRecord(value)) return [];
  const sourceUrl = stringValue(value.originallink) ?? stringValue(value.link);
  if (sourceUrl === undefined) return [];
  const publishedAt = stringValue(value.pubDate);
  return [
    {
      title: stripHtml(stringValue(value.title) ?? ''),
      description: stripHtml(stringValue(value.description) ?? ''),
      sourceUrl,
      naverUrl: stringValue(value.link),
      publisherName: inferPublisher(sourceUrl),
      publishedAt:
        publishedAt === undefined || Number.isNaN(Date.parse(publishedAt))
          ? undefined
          : new Date(publishedAt).toISOString(),
    },
  ];
}

function extractText(html: string): string {
  const preferred =
    html.match(
      /<(?:article|div)[^>]*(?:id|class)=["'][^"']*(?:newsct_article|dic_area|article_body|article-body)[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)>/i,
    )?.[1] ?? html;
  return stripHtml(preferred).replace(/\s+/g, ' ').trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function inferPublisher(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonBody(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error: unknown) {
    throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
      retryable: true,
      resultUncertain: true,
      cause: error,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw pipelineExternalException(PipelineExceptionCode.InvalidOutput, { cause: error });
  }
}
