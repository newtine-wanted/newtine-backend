/**
 * Normalizes an article URL for application-level duplicate comparison.
 *
 * The persisted article_url remains the provider's raw URL. Query parameters
 * and a meaningful trailing slash are intentionally preserved because they
 * may identify different source pages.
 */
export function normalizePipelineArticleUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed;
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    ) {
      url.port = '';
    }
    url.hash = '';
    if (url.pathname.length === 0) url.pathname = '/';
    return url.toString();
  } catch {
    return trimmed;
  }
}
