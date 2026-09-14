import type {
  FetchedArticle,
  GeneratedIssueContent,
  SemanticValidationResult,
  UuidV7,
} from './pipeline.types.js';

export interface ContentValidationFailure {
  ok: false;
  reason: string;
}

export interface ContentValidationSuccess {
  ok: true;
}

export type ContentValidationResult = ContentValidationFailure | ContentValidationSuccess;

export function validateGeneratedContent(
  content: GeneratedIssueContent,
  fetchedArticles: readonly FetchedArticle[],
): ContentValidationResult {
  if (
    content === null ||
    typeof content !== 'object' ||
    typeof content.integratedSummary !== 'string' ||
    !Array.isArray(content.summaryLines) ||
    !Array.isArray(content.glossary) ||
    !Array.isArray(content.impacts) ||
    (content.viewpoints !== null && !Array.isArray(content.viewpoints))
  ) {
    return failure('content has an invalid shape');
  }
  const articleIds = new Set(fetchedArticles.map((article) => article.articleId));
  if (content.integratedSummary.trim().length === 0) return failure('integrated_summary is empty');
  if (
    content.summaryLines.length !== 3 ||
    content.summaryLines.some((line) => typeof line !== 'string' || line.trim().length === 0)
  ) {
    return failure('summary_lines must contain three non-empty lines');
  }
  if (content.glossary.length > 5) return failure('glossary exceeds five entries');
  for (const viewpoint of content.viewpoints ?? []) {
    if (
      viewpoint === null ||
      typeof viewpoint !== 'object' ||
      typeof viewpoint.statement !== 'string' ||
      !Array.isArray(viewpoint.articleIds)
    ) {
      return failure('viewpoint has an invalid shape');
    }
    const result = validateArticleReferences(viewpoint.articleIds, articleIds);
    if (!result.ok) return failure(`viewpoint: ${result.reason}`);
    if (viewpoint.statement.trim().length === 0) return failure('viewpoint statement is empty');
  }
  for (const glossary of content.glossary) {
    if (
      glossary === null ||
      typeof glossary !== 'object' ||
      typeof glossary.term !== 'string' ||
      typeof glossary.definition !== 'string' ||
      !Array.isArray(glossary.articleIds)
    ) {
      return failure('glossary has an invalid shape');
    }
    const result = validateArticleReferences(glossary.articleIds, articleIds);
    if (!result.ok) return failure(`glossary: ${result.reason}`);
    if (glossary.term.trim().length === 0 || glossary.definition.trim().length === 0) {
      return failure('glossary term and definition are required');
    }
  }
  for (const impact of content.impacts) {
    if (
      impact === null ||
      typeof impact !== 'object' ||
      impact.targetType !== 'AGE_GROUP' ||
      !isImpactTargetValue(impact.targetValue) ||
      typeof impact.description !== 'string' ||
      !Array.isArray(impact.articleIds)
    ) {
      return failure('impact has an invalid shape');
    }
    const result = validateArticleReferences(impact.articleIds, articleIds);
    if (!result.ok) return failure(`impact: ${result.reason}`);
    if (impact.description.trim().length === 0) return failure('impact description is empty');
  }
  return { ok: true };
}

export function validateSemanticResult(
  result: SemanticValidationResult,
  fetchedArticles: readonly FetchedArticle[],
): ContentValidationResult {
  if (
    result === null ||
    typeof result !== 'object' ||
    (result.status !== 'PASS' && result.status !== 'FAIL' && result.status !== 'UNCERTAIN') ||
    typeof result.reason !== 'string' ||
    !Array.isArray(result.independentEvidenceGroups) ||
    !Array.isArray(result.conflicts) ||
    result.conflicts.some((conflict) => typeof conflict !== 'string') ||
    result.conflicts.some((conflict) => conflict.trim().length === 0)
  ) {
    return failure('semantic validation has an invalid shape');
  }
  if (result.status === 'PASS' && result.conflicts.length > 0) {
    return failure('semantic validation PASS cannot contain conflicts');
  }
  if (result.status !== 'PASS')
    return failure(`semantic validation ${result.status}: ${result.reason}`);
  const articleIds = new Set(fetchedArticles.map((article) => article.articleId));
  if (result.independentEvidenceGroups.length < 2) {
    return failure('at least two independent evidence groups are required');
  }
  const seen = new Set<UuidV7>();
  for (const group of result.independentEvidenceGroups) {
    if (!Array.isArray(group)) return failure('an evidence group has an invalid shape');
    if (group.length === 0) return failure('an evidence group is empty');
    if (new Set(group).size !== group.length)
      return failure('an evidence group contains duplicate article references');
    const refs = validateArticleReferences(group, articleIds);
    if (!refs.ok) return failure(`semantic evidence: ${refs.reason}`);
    if (group.some((articleId) => seen.has(articleId))) {
      return failure('independent evidence groups must not overlap');
    }
    for (const articleId of group) seen.add(articleId);
  }
  if (seen.size < 2) return failure('independent evidence must reference two articles');
  return { ok: true };
}

function validateArticleReferences(
  ids: readonly UuidV7[],
  available: ReadonlySet<UuidV7>,
): ContentValidationResult {
  if (!Array.isArray(ids)) return failure('article references must be an array');
  if (ids.length === 0) return failure('at least one article reference is required');
  for (const id of ids) {
    if (!available.has(id)) return failure(`article reference ${id} is outside fetched input`);
  }
  return { ok: true };
}

function failure(reason: string): ContentValidationFailure {
  return { ok: false, reason };
}

function isImpactTargetValue(
  value: unknown,
): value is GeneratedIssueContent['impacts'][number]['targetValue'] {
  return (
    value === 'AGE_19_34' ||
    value === 'AGE_35_49' ||
    value === 'AGE_50_64' ||
    value === 'AGE_65_PLUS'
  );
}
