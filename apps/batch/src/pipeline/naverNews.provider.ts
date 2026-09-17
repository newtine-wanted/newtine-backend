import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

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
const MAX_ARTICLE_REDIRECT_HOPS = 3;
const MAX_ARTICLE_BODY_BYTES = 2 * 1024 * 1024;
const MIN_ARTICLE_BODY_LENGTH = 200;
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const BLOCKED_IPV4_RANGES: readonly [number, number][] = [
  [0x00000000, 0x00ffffff], // current network
  [0x0a000000, 0x0affffff], // private
  [0x64400000, 0x647fffff], // carrier-grade NAT
  [0x7f000000, 0x7fffffff], // loopback
  [0xa9fe0000, 0xa9feffff], // link-local
  [0xac100000, 0xac1fffff], // private
  [0xc0000000, 0xc00000ff], // IETF protocol assignments
  [0xc0000200, 0xc00002ff], // documentation
  [0xc01fc400, 0xc01fc4ff], // AS112
  [0xc0586300, 0xc05863ff], // 6to4 relay anycast
  [0xc0a80000, 0xc0a8ffff], // private
  [0xc034c100, 0xc034c1ff], // AS112
  [0xc0af3000, 0xc0af30ff], // AS112
  [0xc6120000, 0xc613ffff], // benchmarking
  [0xc6336400, 0xc63364ff], // documentation
  [0xcb007100, 0xcb0071ff], // documentation
  [0xe0000000, 0xffffffff], // multicast and reserved
];
const BLOCKED_IPV6_RANGES: readonly [string, number][] = [
  ['2001:0::', 23], // IETF protocol assignments, including Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
];

export type ArticleAddress = { address: string; family: number };
type ArticleNetwork = {
  resolve: (hostname: string) => Promise<ArticleAddress[]>;
  request: (
    url: URL,
    init: RequestInit,
    address: ArticleAddress,
    timeoutMs: number,
  ) => Promise<Response>;
};

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
    const sourceUrl = article.sourceUrl;
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    }
    const response = await fetchExternalArticle(
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
    const body = extractArticleText(html);
    if (body.length < MIN_ARTICLE_BODY_LENGTH || article.id === undefined)
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

export const naverArticleNetwork: ArticleNetwork = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: requestPinnedArticle,
};

async function fetchExternalArticle(
  initialUrl: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let currentUrl = new URL(initialUrl.toString());
  for (let hop = 0; ; hop += 1) {
    const addresses = await assertPublicArticleUrl(currentUrl);
    let response: Response | undefined;
    let lastError: unknown;
    for (const address of addresses) {
      try {
        response = await naverArticleNetwork.request(
          currentUrl,
          { ...init, redirect: 'manual' },
          address,
          timeoutMs,
        );
        break;
      } catch (error: unknown) {
        lastError = error;
        if (!(error instanceof PipelineException) || !error.retryable) throw error;
      }
    }
    if (response === undefined) {
      throw (
        lastError ??
        pipelineExternalException(PipelineExceptionCode.UpstreamError, {
          retryable: true,
          resultUncertain: true,
        })
      );
    }
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

export function buildPinnedArticleRequestOptions(
  url: URL,
  init: RequestInit,
  address: ArticleAddress,
) {
  const headers = new Headers(init.headers);
  headers.set('host', url.host);
  headers.set('accept-encoding', 'identity');
  return {
    protocol: url.protocol,
    hostname: address.address,
    family: address.family,
    ...(url.port === '' ? {} : { port: Number(url.port) }),
    path: `${url.pathname}${url.search}`,
    method: init.method ?? 'GET',
    headers: Object.fromEntries(headers.entries()),
    ...(url.protocol === 'https:' && isIP(normalizeHostname(url.hostname)) === 0
      ? { servername: normalizeHostname(url.hostname) }
      : {}),
  };
}

async function requestPinnedArticle(
  url: URL,
  init: RequestInit,
  address: ArticleAddress,
  timeoutMs: number,
): Promise<Response> {
  const requestFunction = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const requestOptions = buildPinnedArticleRequestOptions(url, init, address);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  return new Promise<Response>((resolve, reject) => {
    let incoming: IncomingMessage | undefined;
    let settled = false;

    const cleanup = (): void => {
      timeoutSignal.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        pipelineExternalException(PipelineExceptionCode.UpstreamError, {
          retryable: true,
          resultUncertain: true,
          cause: error,
        }),
      );
    };
    const onAbort = (): void => {
      const reason = new Error('Pinned article request timed out');
      if (incoming !== undefined) incoming.destroy(reason);
      else clientRequest.destroy(reason);
    };

    const clientRequest = requestFunction(requestOptions, (response) => {
      incoming = response;
      response.once('close', cleanup);
      response.once('error', cleanup);
      try {
        const body = Readable.toWeb(response) as ReadableStream<Uint8Array>;
        const result = new Response(body, {
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          headers: toFetchHeaders(response.headers),
        });
        settled = true;
        resolve(result);
      } catch (error: unknown) {
        response.destroy();
        fail(error);
      }
    });
    clientRequest.once('error', fail);
    clientRequest.setTimeout(timeoutMs, () =>
      clientRequest.destroy(new Error('Pinned article request timed out')),
    );
    timeoutSignal.addEventListener('abort', onAbort, { once: true });
    if (timeoutSignal.aborted) onAbort();
    clientRequest.end();
  });
}

function toFetchHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) result.append(name, item);
  }
  return result;
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

function isAllowedExternalUrl(url: URL): boolean {
  const defaultPort = url.protocol === 'http:' ? '80' : '443';
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    (url.port === '' || url.port === defaultPort) &&
    url.username === '' &&
    url.password === '' &&
    url.hostname.length > 0
  );
}

async function assertPublicArticleUrl(url: URL): Promise<ArticleAddress[]> {
  if (!isAllowedExternalUrl(url))
    throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);

  const hostname = normalizeHostname(url.hostname);
  if (isIP(hostname) !== 0) {
    if (!isPublicIpAddress(hostname))
      throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
    return [{ address: hostname, family: isIP(hostname) }];
  }

  let addresses: ArticleAddress[];
  try {
    addresses = await withTimeout(naverArticleNetwork.resolve(hostname), DNS_LOOKUP_TIMEOUT_MS);
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === 'EAI_AGAIN' || code === 'ETIMEDOUT') {
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
        retryable: true,
        resultUncertain: true,
        cause: error,
      });
    }
    throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable, { cause: error });
  }
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) => (family !== 4 && family !== 6) || !isPublicIpAddress(address),
    )
  ) {
    throw pipelineExternalException(PipelineExceptionCode.SourceUnavailable);
  }
  return addresses;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('DNS lookup timed out') as Error & { code: string };
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isPublicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').split('%', 1)[0] ?? '';
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const value = parseIpv4(address);
  if (value === undefined) return false;
  return isPublicIpv4Number(value);
}

function isPublicIpv4Number(
  value: number,
  blockedRanges: readonly [number, number][] = BLOCKED_IPV4_RANGES,
): boolean {
  return blockedRanges.every(([start, end]) => value < start || value > end);
}

function isPublicIpv6(address: string): boolean {
  const value = parseIpv6(address);
  if (value === undefined) return false;
  if (value >> 125n !== 1n) return false; // only global-unicast 2000::/3
  return BLOCKED_IPV6_RANGES.every(
    ([network, prefix]) => !matchesIpv6Range(value, network, prefix),
  );
}

function matchesIpv6Range(value: bigint, network: string, prefix: number): boolean {
  const networkValue = parseIpv6(network);
  if (networkValue === undefined) return true;
  const shift = 128n - BigInt(prefix);
  return value >> shift === networkValue >> shift;
}

function parseIpv4(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) || octet < 0 || octet > 255 || parts[index]?.length === 0,
    )
  )
    return undefined;
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
}

function parseIpv6(address: string): bigint | undefined {
  const sections = address.split('::');
  if (sections.length > 2) return undefined;
  const left = sections[0] === '' ? [] : parseIpv6Words(sections[0]!.split(':'));
  const right =
    sections.length === 2 && sections[1] !== '' ? parseIpv6Words(sections[1]!.split(':')) : [];
  if (left === undefined || right === undefined) return undefined;
  const missing = sections.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (sections.length === 1 && left.length !== 8)) return undefined;
  const words = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  if (words.length !== 8) return undefined;
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}

function parseIpv6Words(parts: string[]): number[] | undefined {
  const words: number[] = [];
  for (const part of parts) {
    if (part.includes('.')) {
      const ipv4 = parseIpv4(part);
      if (ipv4 === undefined) return undefined;
      words.push(ipv4 >>> 16, ipv4 & 0xffff);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return undefined;
    words.push(Number.parseInt(part, 16));
  }
  return words.length > 8 ? undefined : words;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
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

function extractArticleText(html: string): string {
  const sanitized = removeNonContentMarkup(html);
  const candidateBlocks = [
    ...extractTagContents(sanitized, 'article'),
    ...extractAttributeMatchedBlocks(sanitized),
    ...extractTagContents(sanitized, 'main'),
    ...extractTagContents(sanitized, 'section'),
  ];
  const candidateTexts = candidateBlocks.map(stripHtmlToText).filter((text) => text.length > 0);
  const viableCandidates = candidateTexts.filter((text) => text.length >= MIN_ARTICLE_BODY_LENGTH);
  if (viableCandidates.length > 0) return longestText(viableCandidates);
  return longestText([...candidateTexts, stripHtmlToText(sanitized)]);
}

function removeNonContentMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|template|svg|canvas|iframe|form|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      ' ',
    );
}

function extractTagContents(html: string, tag: string): string[] {
  const openingPattern = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = openingPattern.exec(html)) !== null && blocks.length < 24) {
    if (/\/\s*>$/.test(match[0])) continue;
    const content = extractBalancedTagContent(html, tag, openingPattern.lastIndex);
    if (content !== undefined) blocks.push(content);
  }
  return blocks;
}

function extractAttributeMatchedBlocks(html: string): string[] {
  const pattern =
    /<(div|section)\b[^>]*(?:id|class)=["'][^"']*(?:article|content|body|story|post|entry|news|detail|본문|기사)[^"']*["'][^>]*>/gi;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null && blocks.length < 24) {
    const tag = match[1]!.toLowerCase();
    if (/\/\s*>$/.test(match[0])) continue;
    const content = extractBalancedTagContent(html, tag, pattern.lastIndex);
    if (content !== undefined) blocks.push(content);
  }
  return blocks;
}

function extractBalancedTagContent(
  html: string,
  tag: string,
  contentStart: number,
): string | undefined {
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    if (match[0].startsWith('</')) depth -= 1;
    else if (!/\/\s*>$/.test(match[0])) depth += 1;
    if (depth === 0) return html.slice(contentStart, match.index);
  }
  return undefined;
}

function stripHtmlToText(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|main)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function longestText(values: readonly string[]): string {
  return values.reduce((longest, value) => (value.length > longest.length ? value : longest), '');
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
    .replace(/&gt;/gi, '>')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code: string) => {
      const number = code.toLowerCase().startsWith('x')
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : match;
    });
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
