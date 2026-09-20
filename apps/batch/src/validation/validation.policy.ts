import { calculateScores, eventTime, termKey } from '../generation/generation.policy.js';
import { GENERATIONS, type GenerationResult } from '../generation/generation.types.js';
import {
  FIELDS,
  type Field,
  type Finding,
  type Patch,
  type Review,
  type ValidationSnapshot,
} from './validation.types.js';
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function rules(r: GenerationResult, s: ValidationSnapshot): Finding[] {
  const findings: Finding[] = [];
  const fail = (field: Finding['field'], reason: string) =>
    findings.push({ field, category: 'RULE', reason, articleIds: [] });
  if (
    !Array.isArray(r.articles) ||
    r.articles.length < 2 ||
    r.articles.length > 5 ||
    r.articles.some((a) => !text(a.body) || !text(a.articleId)) ||
    new Set(r.articles.map((a) => a.articleId)).size !== r.articles.length
  ) {
    fail('source', '본문 2~5개 및 고유 기사 ID가 필요합니다.');
    return findings;
  }
  const refs = (ids: unknown, required = false): boolean =>
    Array.isArray(ids) &&
    (!required || ids.length > 0) &&
    new Set(ids).size === ids.length &&
    ids.every((id) => r.articles.some((a) => a.articleId === id));
  const d = r.draft;
  if (!d) {
    fail('source', '생성 초안이 없습니다.');
    return findings;
  }
  for (const field of ['title', 'integratedSummary', 'importanceReason'] as const)
    if (!text(d[field])) fail(field, '비어 있지 않은 문자열이 필요합니다.');
  if (
    !(
      d.eventAt === null ||
      (text(d.eventAt) &&
        Number.isFinite(Date.parse(d.eventAt)) &&
        Date.parse(d.eventAt) <= Date.parse(s.generationAt))
    )
  )
    fail('eventAt', '사건 시각은 생성 기준 시각 이전의 날짜 또는 null이어야 합니다.');
  if (!(d.eventEvidence === null || text(d.eventEvidence)))
    fail('eventEvidence', '사건 근거는 원문 인용 또는 null이어야 합니다.');
  if (
    d.eventAt !== null &&
    (!text(d.eventEvidence) || !r.articles.some((a) => a.body.includes(d.eventEvidence!)))
  )
    fail('eventEvidence', '사건 시각의 원문 근거가 없습니다.');
  if (!Array.isArray(d.summaryLines) || d.summaryLines.length !== 3 || !d.summaryLines.every(text))
    fail('summaryLines', '요약은 비어 있지 않은 3줄이어야 합니다.');
  if (
    !Array.isArray(d.viewpoints) ||
    d.viewpoints.length !== 2 ||
    d.viewpoints.some(
      (v) => !v || !text(v.stakeholder) || !text(v.statement) || !refs(v.articleIds, true),
    ) ||
    new Set(d.viewpoints.map((v) => termKey(v.stakeholder))).size !== 2
  )
    fail('viewpoints', '서로 다른 이해관계자 관점 2개와 유효한 근거가 필요합니다.');
  if (
    !Array.isArray(d.impacts) ||
    d.impacts.length !== 4 ||
    GENERATIONS.some((g) => d.impacts.filter((i) => i?.generation === g).length !== 1) ||
    d.impacts.some((i) => !i || !text(i.description) || !refs(i.articleIds))
  )
    fail('impacts', '4개 세대의 설명과 유효한 근거 참조가 필요합니다.');
  if (findings.length) return findings;
  if (d.sharedConditionalImpact != null) {
    const c = d.sharedConditionalImpact;
    if (!text(c.description) || !refs(c.articleIds, true))
      fail('sharedConditionalImpact', '공통 조건부 영향과 근거가 필요합니다.');
    if (
      Array.isArray(d.impacts) &&
      d.impacts.some((i) => i.description !== c.description || !same(i.articleIds, c.articleIds))
    )
      fail('impacts', '공통 영향의 설명과 근거를 4개 세대에 동일하게 적용해야 합니다.');
  }
  if (
    !Number.isFinite(d.llmEstimatedImportance) ||
    d.llmEstimatedImportance < 0 ||
    d.llmEstimatedImportance > 1
  )
    fail('llmEstimatedImportance', 'LLM 추정 중요도는 0~1이어야 합니다.');
  if (
    !Array.isArray(d.generations) ||
    d.generations.some((g) => !GENERATIONS.includes(g)) ||
    new Set(d.generations).size !== d.generations.length
  )
    fail('generations', '관련 세대는 중복 없는 허용 코드여야 합니다.');
  const generated = [
    d.title,
    d.integratedSummary,
    ...(d.summaryLines ?? []),
    ...(d.viewpoints ?? []).map((v) => v?.statement),
    ...(d.impacts ?? []).map((i) => i?.description),
  ]
    .filter(text)
    .map(termKey)
    .join('\n');
  if (
    !Array.isArray(d.terms) ||
    d.terms.length > 5 ||
    d.terms.some((t) => !text(t) || t.length > 80 || !generated.includes(termKey(t))) ||
    new Set(d.terms.map(termKey)).size !== d.terms.length
  )
    fail('terms', '용어는 생성 내용에 등장하는 중복 없는 최대 5개여야 합니다.');
  const f = d.followUp;
  if (
    !f ||
    typeof f.enabled !== 'boolean' ||
    !Number.isSafeInteger(f.days) ||
    f.days < 0 ||
    f.days > s.config.maxTrackingDays ||
    !Array.isArray(f.queries) ||
    f.queries.length > 3 ||
    f.queries.some((q) => !text(q) || q.length > 200) ||
    !text(f.reason) ||
    (f.enabled && (!f.days || !f.queries.length)) ||
    (!f.enabled && (f.days !== 0 || f.queries.length !== 0))
  )
    fail('followUp', '후속 추적 기간·검색어·활성 상태가 맞지 않습니다.');
  if (findings.length) return findings;
  const c = r.classification;
  if (
    !c ||
    (['topics', 'regions', 'entities'] as const).some(
      (k) =>
        !Array.isArray(c[k]) ||
        new Set(c[k]).size !== c[k].length ||
        c[k].some((code) => !s.catalog[k].some((row) => row.code === code)),
    ) ||
    !same(c.generations, d.generations)
  )
    fail('classification', '분류는 허용 DB 코드이며 관련 세대와 일치해야 합니다.');
  if (
    !Array.isArray(r.glossary) ||
    !Array.isArray(d.terms) ||
    r.glossary.length !== d.terms.length ||
    r.glossary.some(
      (g) =>
        !g || !text(g.term) || !text(g.definition) || !['DATABASE', 'GENERATED'].includes(g.source),
    ) ||
    d.terms.some(
      (t) => r.glossary!.filter((g) => text(g.term) && termKey(g.term) === termKey(t)).length !== 1,
    )
  )
    fail('glossary', '추출 용어마다 하나의 설명이 필요합니다.');
  try {
    const time = eventTime(d, r.articles, s.generationAt, r.source.selectedArticles);
    const scores = calculateScores({ ...r, ...time }, s.generationAt, s.config);
    if (
      r.eventAt !== time.eventAt ||
      r.eventAtSource !== time.eventAtSource ||
      !r.scores ||
      Object.entries(scores).some(([k, v]) =>
        typeof v === 'number'
          ? !Number.isFinite(r.scores![k as keyof typeof scores] as number) ||
            Math.abs((r.scores![k as keyof typeof scores] as number) - v) > 1e-9
          : r.scores![k as keyof typeof scores] !== v,
      )
    )
      fail('scores', '사건 시각·점수가 원본 입력 및 계산식과 일치하지 않습니다.');
  } catch {
    fail('source', '계산에 필요한 기사 시각 또는 입력이 없습니다.');
  }
  return findings;
}
export function checkedReview(value: Review, r: GenerationResult): Review {
  if (
    !value ||
    !Array.isArray(value.findings) ||
    value.findings.some(
      (f) =>
        !f ||
        ![...FIELDS, 'source', 'scores'].includes(f.field) ||
        !['FACT', 'CONSISTENCY', 'UX'].includes(f.category) ||
        !text(f.reason) ||
        !Array.isArray(f.articleIds) ||
        f.articleIds.some((id) => !r.articles.some((a) => a.articleId === id)),
    )
  )
    throw new Error('INVALID_VALIDATION_REVIEW');
  return value;
}
export function repairFields(findings: Finding[]): Field[] {
  const fields = new Set<Field>(
    findings
      .map((f) => f.field)
      .filter((f): f is Field => (FIELDS as readonly string[]).includes(f)),
  );
  for (const group of [
    ['eventAt', 'eventEvidence'],
    ['sharedConditionalImpact', 'impacts'],
    ['generations', 'classification'],
    ['terms', 'glossary'],
  ] as Field[][])
    if (group.some((f) => fields.has(f))) group.forEach((f) => fields.add(f));
  return [...fields];
}
export function applyPatches(
  r: GenerationResult,
  patches: Patch[],
  fields: Field[],
  s: ValidationSnapshot,
): GenerationResult {
  if (
    !Array.isArray(patches) ||
    patches.length !== fields.length ||
    fields.some((f) => patches.filter((p) => p?.field === f).length !== 1) ||
    patches.some((p) => !fields.includes(p.field))
  )
    throw new Error('INVALID_VALIDATION_PATCH');
  const next = structuredClone(r);
  for (const patch of patches) {
    if (patch.field === 'classification')
      next.classification = patch.value as GenerationResult['classification'];
    else if (patch.field === 'glossary') {
      if (!Array.isArray(patch.value)) throw new Error('INVALID_VALIDATION_PATCH');
      next.glossary = patch.value.map((g) => ({ ...g, source: 'GENERATED' }));
    } else (next.draft as unknown as Record<string, unknown>)[patch.field] = patch.value;
  }
  // Computed values are never accepted from the model.
  try {
    Object.assign(
      next,
      eventTime(next.draft!, next.articles, s.generationAt, next.source.selectedArticles),
    );
    next.scores = calculateScores(next, s.generationAt, s.config);
  } catch {
    /* The final rule check records missing source data. */
  }
  return next;
}
