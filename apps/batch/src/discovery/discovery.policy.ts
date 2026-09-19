import { generateUuidV7, normalizePipelineArticleUrl, type DiscoveredArticle } from '@newtine/core';
import type { Candidate, DiscoveryConfig, SearchQuery } from './discovery.types.js';

export const MAX_CANDIDATES_PER_QUERY = 3;
export const MAX_CANDIDATE_SEARCH_TITLE_LENGTH = 60;

export function parseDiscoveryConfig(value: unknown): DiscoveryConfig {
  if (!value || typeof value !== 'object') throw new Error('INVALID_DISCOVERY_CONFIG');
  const config = value as DiscoveryConfig;
  for (const [key, max] of Object.entries({
    articlesPerQuery: 100,
    candidatesPerQuery: MAX_CANDIDATES_PER_QUERY,
    maxQueries: 1000,
    maxCandidates: 2000,
  })) {
    const n = config[key as keyof DiscoveryConfig];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > max)
      throw new Error(`INVALID_CONFIG_${key}`);
  }
  if (
    !Array.isArray(config.entityTypes) ||
    config.entityTypes.length === 0 ||
    config.entityTypes.some((t) => !['POLITICIAN', 'INSTITUTION', 'PARTY'].includes(t))
  )
    throw new Error('INVALID_ENTITY_TYPES');
  return config;
}
export const normalizedTitle = (value: string): string =>
  value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const seoulDay = (at: Date): string =>
  new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export function mergeQueries(queries: SearchQuery[]): SearchQuery[] {
  const unique = new Map<string, SearchQuery>();
  for (const query of queries) {
    const text = query.text.trim().replace(/\s+/g, ' ');
    if (!text || text.length > 200) throw new Error('INVALID_SEARCH_QUERY');
    const key = JSON.stringify([normalizedTitle(text), query.parentIssueId ?? null, query.since]);
    const existing = unique.get(key);
    if (existing) existing.origins = [...new Set([...existing.origins, ...query.origins])];
    else unique.set(key, { ...query, text });
  }
  return [...unique.values()];
}
export function filterArticles(
  articles: DiscoveredArticle[],
  query: SearchQuery,
  until: string,
  limit: number,
): DiscoveredArticle[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  return articles
    .filter((a) => {
      const date = Date.parse(a.publishedAt ?? '');
      const title = normalizedTitle(a.title);
      let url: string;
      try {
        const parsed = new URL(a.sourceUrl);
        if (!['https:', 'http:'].includes(parsed.protocol)) return false;
        url = normalizePipelineArticleUrl(a.sourceUrl);
      } catch {
        return false;
      }
      if (
        !title ||
        a.title.length > 1000 ||
        !Number.isFinite(date) ||
        date > Date.parse(until) ||
        (query.parentIssueId ? date <= Date.parse(query.since) : date < Date.parse(query.since)) ||
        seenUrls.has(url) ||
        seenTitles.has(title)
      )
        return false;
      seenUrls.add(url);
      seenTitles.add(title);
      return true;
    })
    .slice(0, limit)
    .map((a) => ({ ...a, id: a.id ?? generateUuidV7() }));
}
export function checkedIndexes(value: unknown, length: number, allowEmpty = false): number[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    new Set(value).size !== value.length ||
    value.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= length)
  )
    throw new Error('INVALID_TITLE_INDEXES');
  return value as number[];
}
export function validateGroups(groups: number[][], length: number): void {
  if (!Array.isArray(groups)) throw new Error('INVALID_DUPLICATE_GROUPS');
  const indices = groups.flatMap((group) => checkedIndexes(group, length));
  if (indices.length !== length || new Set(indices).size !== length)
    throw new Error('INCOMPLETE_DUPLICATE_GROUPS');
}
export function mergeCandidates(candidates: Candidate[]): Candidate {
  const first = candidates[0];
  if (!first) throw new Error('EMPTY_CANDIDATE_GROUP');
  const articles: DiscoveredArticle[] = [];
  const urls = new Set<string>();
  const titles = new Set<string>();
  for (const a of candidates.flatMap((c) => c.articles)) {
    const url = normalizePipelineArticleUrl(a.sourceUrl);
    const title = normalizedTitle(a.title);
    if (!urls.has(url) && !titles.has(title)) articles.push(a);
    urls.add(url);
    titles.add(title);
  }
  return {
    ...first,
    articles,
    queries: [...new Set(candidates.flatMap((c) => c.queries))],
    origins: [...new Set(candidates.flatMap((c) => c.origins))],
    parentIssueIds: [...new Set(candidates.flatMap((c) => c.parentIssueIds))],
    mergedCandidateIds: [...new Set(candidates.flatMap((c) => c.mergedCandidateIds))],
  };
}
