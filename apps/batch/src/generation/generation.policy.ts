import type { FetchedArticle } from '@newtine/core';
import { normalizedTitle } from '../discovery/discovery.policy.js';
import { DEFAULT_OPENAI_TEXT_MODEL } from '../ai/ai-model.defaults.js';
import {
  GENERATIONS,
  type Catalog,
  type Classification,
  type Draft,
  type GenerationConfig,
  type GenerationResult,
  type Usage,
} from './generation.types.js';

export function parseGenerationConfig(value: unknown): GenerationConfig {
  const c = value as GenerationConfig;
  if (
    !c ||
    !Number.isSafeInteger(c.bodyCharacters) ||
    c.bodyCharacters < 1000 ||
    c.bodyCharacters > 18000 ||
    !Number.isFinite(c.freshnessHalfLifeHours) ||
    c.freshnessHalfLifeHours <= 0 ||
    !Number.isSafeInteger(c.maxTrackingDays) ||
    c.maxTrackingDays < 1 ||
    c.maxTrackingDays > 30
  )
    throw new Error('INVALID_GENERATION_CONFIG');
  return c;
}
export const termKey = (term: string): string => normalizedTitle(term);
export function ruleClassification(
  catalog: Catalog,
  articles: FetchedArticle[],
): Omit<Classification, 'generations'> {
  // Match unambiguous catalog names in titles; body-only mentions are left to the model.
  const text = articles.map((a) => normalizedTitle(a.title)).join('\n');
  const match = (name: string) => {
    const escaped = normalizedTitle(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
      name.length >= 2 &&
      new RegExp(
        `(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}]|은|는|이|가|의|을|를|에|와|과)`,
        'u',
      ).test(text)
    );
  };
  return Object.fromEntries(
    Object.entries(catalog).map(([key, rows]) => [
      key,
      rows.filter((r: { name: string }) => match(r.name)).map((r: { code: string }) => r.code),
    ]),
  ) as Omit<Classification, 'generations'>;
}
export function checkedClassification(
  value: Omit<Classification, 'generations'>,
  catalog: Partial<Catalog>,
): Omit<Classification, 'generations'> {
  for (const key of ['topics', 'regions', 'entities'] as const) {
    if (
      !Array.isArray(value?.[key]) ||
      value[key].some((code) => !(catalog[key] ?? []).some((row) => row.code === code))
    )
      throw new Error('INVALID_CLASSIFICATION');
    value[key] = [...new Set(value[key])];
  }
  return value;
}
export function checkDraft(
  draft: Draft,
  articles: FetchedArticle[],
  config: GenerationConfig,
): Draft {
  const text = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
  const refs = (ids: string[]) =>
    Array.isArray(ids) && ids.every((id) => articles.some((a) => a.articleId === id));
  if (
    !draft ||
    !text(draft.title) ||
    !text(draft.integratedSummary) ||
    !Array.isArray(draft.summaryLines) ||
    draft.summaryLines.length !== 3 ||
    !draft.summaryLines.every(text) ||
    !Number.isFinite(draft.llmEstimatedImportance) ||
    draft.llmEstimatedImportance < 0 ||
    draft.llmEstimatedImportance > 1 ||
    !text(draft.importanceReason)
  )
    throw new Error('INVALID_GENERATED_DRAFT');
  if (!Array.isArray(draft.generations) || draft.generations.some((g) => !GENERATIONS.includes(g)))
    throw new Error('INVALID_GENERATIONS');
  if (
    !Array.isArray(draft.impacts) ||
    draft.impacts.length !== GENERATIONS.length ||
    GENERATIONS.some((g) => draft.impacts.filter((i) => i.generation === g).length !== 1) ||
    draft.impacts.some((i) => !text(i.description) || !refs(i.articleIds))
  )
    throw new Error('INVALID_GENERATION_IMPACTS');
  if (draft.sharedConditionalImpact != null) {
    const shared = draft.sharedConditionalImpact;
    if (!text(shared.description) || !refs(shared.articleIds) || !shared.articleIds.length)
      throw new Error('INVALID_SHARED_IMPACT');
    draft.impacts = GENERATIONS.map((generation) => ({
      generation,
      description: shared.description,
      articleIds: [...shared.articleIds],
    }));
  }
  if (
    !Array.isArray(draft.viewpoints) ||
    draft.viewpoints.length !== 2 ||
    draft.viewpoints.some(
      (v) =>
        !text(v.stakeholder) ||
        !text(v.statement) ||
        !refs(v.articleIds) ||
        v.articleIds.length < 1,
    ) ||
    new Set(draft.viewpoints.map((v) => normalizedTitle(v.stakeholder))).size !== 2
  )
    throw new Error('INVALID_VIEWPOINTS');
  if (
    !Array.isArray(draft.terms) ||
    draft.terms.length > 3 ||
    draft.terms.some((t) => !text(t) || t.length > 80)
  )
    throw new Error('INVALID_TERMS');
  const f = draft.followUp;
  if (
    !f ||
    typeof f.enabled !== 'boolean' ||
    !Number.isSafeInteger(f.days) ||
    f.days < 0 ||
    f.days > config.maxTrackingDays ||
    !Array.isArray(f.queries) ||
    f.queries.length > 3 ||
    f.queries.some((q) => !text(q) || q.length > 200) ||
    !text(f.reason) ||
    (f.enabled && (f.days < 1 || !f.queries.length)) ||
    (!f.enabled && (f.days !== 0 || f.queries.length !== 0))
  )
    throw new Error('INVALID_FOLLOW_UP');
  const generated = [
    draft.title,
    draft.integratedSummary,
    ...draft.summaryLines,
    ...draft.impacts.map((i) => i.description),
    ...(draft.viewpoints ?? []).map((v) => v.statement),
  ]
    .map(normalizedTitle)
    .join('\n');
  draft.terms = [
    ...new Map(
      draft.terms.filter((t) => generated.includes(termKey(t))).map((t) => [termKey(t), t]),
    ).values(),
  ];
  return draft;
}
export function eventTime(
  draft: Draft,
  articles: FetchedArticle[],
  at: string,
  reports: { publishedAt?: string }[] = articles,
): { eventAt: string; eventAtSource: 'ARTICLE_EVENT' | 'FIRST_REPORT' } {
  const event = Date.parse(draft.eventAt ?? '');
  // Require an exact source excerpt as provenance; semantic verification belongs to stage four.
  if (
    Number.isFinite(event) &&
    event <= Date.parse(at) &&
    draft.eventEvidence &&
    articles.some((a) => a.body.includes(draft.eventEvidence!))
  )
    return { eventAt: new Date(event).toISOString(), eventAtSource: 'ARTICLE_EVENT' };
  const times = reports
    .map((a) => Date.parse(a.publishedAt ?? ''))
    .filter((t) => Number.isFinite(t) && t <= Date.parse(at));
  if (!times.length) throw new Error('ARTICLE_TIMESTAMP_REQUIRED');
  return { eventAt: new Date(Math.min(...times)).toISOString(), eventAtSource: 'FIRST_REPORT' };
}
export function calculateScores(
  result: GenerationResult,
  at: string,
  config: GenerationConfig,
): NonNullable<GenerationResult['scores']> {
  const articles = result.source.articles ?? [];
  const articleCount = articles.length;
  const publisherCount = new Set(
    articles.map((a) => a.publisherName.trim().toLowerCase()).filter(Boolean),
  ).size;
  const llmEstimatedImportance = result.draft!.llmEstimatedImportance;
  const hours = Math.max(0, (Date.parse(at) - Date.parse(result.eventAt!)) / 3600_000);
  return {
    importance:
      0.4 * Math.min(articleCount / 50, 1) +
      0.3 * Math.min(publisherCount / 10, 1) +
      0.3 * llmEstimatedImportance,
    freshness: 2 ** (-hours / config.freshnessHalfLifeHours),
    articleCount,
    publisherCount,
    llmEstimatedImportance,
    at,
  };
}
export function estimateCost(usage: Usage[]): {
  usd: number;
  incomplete: boolean;
  cacheDiscountUnknown: boolean;
} {
  let usd = 0,
    incomplete = false,
    cacheDiscountUnknown = false;
  for (const u of usage) {
    if (
      u.model !== DEFAULT_OPENAI_TEXT_MODEL ||
      !Number.isSafeInteger(u.inputTokens) ||
      !Number.isSafeInteger(u.outputTokens) ||
      u.inputTokens! < 0 ||
      u.outputTokens! < 0
    ) {
      incomplete = true;
      continue;
    }
    const cached = u.cachedInputTokens ?? 0;
    if (!Number.isSafeInteger(cached) || cached < 0 || cached > u.inputTokens!) {
      incomplete = true;
      continue;
    }
    cacheDiscountUnknown ||= u.cachedInputTokens === undefined;
    usd += ((u.inputTokens! - cached) * 0.75 + cached * 0.075 + u.outputTokens! * 4.5) / 1e6;
  }
  return { usd, incomplete, cacheDiscountUnknown };
}
