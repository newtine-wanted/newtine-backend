import type { DiscoveredArticle } from '@newtine/core';
import type { CollectionConfig } from './collection.types.js';

export function parseCollectionConfig(value: unknown): CollectionConfig {
  const c = value as CollectionConfig | null;
  if (
    !c ||
    !Number.isSafeInteger(c.articlesPerQuery) ||
    c.articlesPerQuery < 1 ||
    c.articlesPerQuery > 50 ||
    !Array.isArray(c.publishers)
  )
    throw new Error('INVALID_COLLECTION_CONFIG');
  const domains = new Set<string>();
  for (const publisher of c.publishers) {
    if (
      !publisher ||
      typeof publisher.name !== 'string' ||
      !publisher.name.trim() ||
      !Number.isSafeInteger(publisher.priority) ||
      publisher.priority < 0 ||
      !Array.isArray(publisher.domains) ||
      !publisher.domains.length
    )
      throw new Error('INVALID_PUBLISHER_PRIORITY');
    for (const domain of publisher.domains) {
      if (
        typeof domain !== 'string' ||
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain) ||
        domains.has(domain)
      )
        throw new Error('INVALID_PUBLISHER_DOMAIN');
      domains.add(domain);
    }
  }
  return structuredClone(c);
}
export function publisherPriority(article: DiscoveredArticle, config: CollectionConfig): number {
  let host: string;
  try {
    host = new URL(article.sourceUrl).hostname.toLowerCase();
  } catch {
    return Infinity;
  }
  // The most specific configured domain wins, never a suffix such as fakekbs.co.kr.
  const matches = config.publishers.flatMap((p) =>
    p.domains
      .filter((d) => host === d || host.endsWith(`.${d}`))
      .map((d) => ({ domain: d, priority: p.priority })),
  );
  matches.sort((a, b) => b.domain.length - a.domain.length);
  return matches[0]?.priority ?? Infinity;
}
export function selectArticles(
  articles: DiscoveredArticle[],
  config: CollectionConfig,
): DiscoveredArticle[] {
  return [...articles]
    .sort((a, b) => {
      const pa = publisherPriority(a, config),
        pb = publisherPriority(b, config);
      if (pa !== pb) return pa < pb ? -1 : 1;
      const time = (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0);
      return time || a.sourceUrl.localeCompare(b.sourceUrl);
    })
    .slice(0, 5);
}
