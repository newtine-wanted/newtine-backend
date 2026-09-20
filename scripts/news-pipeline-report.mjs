/* global process, console */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { estimateCost } from '../dist/apps/batch/src/generation/generation.policy.js';
import { writeValidationReport } from './news-validation-report.mjs';
import { writeGenerationReport } from './news-generation-report.mjs';
const [discoveryFile, collectionFile, generationFile, reportFile] = process.argv.slice(2);
if (!discoveryFile || !collectionFile || !generationFile || !reportFile)
  throw new Error('THREE_SNAPSHOTS_AND_REPORT_PATH_REQUIRED');
const [d, c, g] = await Promise.all(
  [discoveryFile, collectionFile, generationFile].map(async (f) =>
    JSON.parse(await readFile(f, 'utf8')),
  ),
);
const generated = g.results.filter((r) => r.status === 'GENERATED');
if (generated.some((r) => r.draft.viewpoints.length !== 2))
  throw new Error('INVALID_VIEWPOINT_COUNT');
if (
  d.results.some(
    (r) =>
      r.candidates.length >
      (r.candidateLimit ??
        (r.query.origins.some((o) => o.startsWith('REGION:')) ? 1 : d.config.candidatesPerQuery)),
  )
)
  throw new Error('INVALID_CANDIDATE_COUNT');
if (
  c.results.length !== d.candidates.length ||
  g.results.length !== c.results.filter((r) => r.status === 'SELECTED').length
)
  throw new Error('SNAPSHOT_COUNT_MISMATCH');
const phases = [
  ['1단계', d],
  ['2단계', c],
  ['3단계', g],
];
const priorUsageFile = process.argv[6];
if (priorUsageFile)
  phases.push(['중단된 2단계 시도', JSON.parse(await readFile(priorUsageFile, 'utf8'))]);
const validationFile = process.argv[7];
const v = validationFile ? JSON.parse(await readFile(validationFile, 'utf8')) : null;
if (v) {
  if (v.results.length !== generated.length) throw new Error('VALIDATION_COUNT_MISMATCH');
  phases.push(['4단계', v]);
}
const interruptedValidationFile = process.argv[8];
if (interruptedValidationFile)
  phases.push(['이전 AI 검증 실행', JSON.parse(await readFile(interruptedValidationFile, 'utf8'))]);
const lines = [
  '# 뉴스 파이프라인 전체 재실행 결과',
  '',
  `- 실행 기준 시각: ${g.at}`,
  d.results.every((r) => r.candidateLimit !== undefined)
    ? '- 주제 검색어 후보 최대 3개, 그 외 최대 1개. 1단계 최근 24시간, 2단계 최근 7일. 3단계 이해관계자 관점은 정확히 2개입니다.'
    : '- 이전 추출 정책: 지역 검색어 후보 최대 1개, 그 외 최대 3개. 1단계 최근 24시간, 2단계 최근 7일. 3단계 이해관계자 관점은 정확히 2개입니다.',
  v
    ? '- 4단계 검증 완료. 5단계 공개 전 결과입니다. 아래 생성 상세는 검증 후 최종값이며 보류 여부와 수정 전후는 검증 상세에 기록합니다.'
    : '- 4단계 검증·5단계 공개 전 초안입니다.',
  '',
  ...(v?.aiValidationEnabled === false
    ? ['- 4단계 AI 검증·재생성 비활성화: 규칙 검사 결과입니다.', '']
    : []),
  ...(v?.validationMode === 'TONE'
    ? ['- 4단계는 규칙 및 공격적·편향적 표현만 검사합니다.', '']
    : []),
  '| 처리 | 결과 |',
  '| --- | ---: |',
  `| 검색어 | ${d.results.length} |`,
  `| 추출 후보 | ${d.results.reduce((n, r) => n + r.candidates.length, 0)} |`,
  `| 무관·지엽적 이슈 제외 | ${d.excludedCandidates?.length ?? 0} |`,
  `| 중복·관련성 정리 후 후보 | ${d.candidates.length} |`,
  `| 2단계 선정 | ${g.results.length} |`,
  `| 2단계 기사 부족 | ${c.results.filter((r) => r.status === 'INSUFFICIENT_ARTICLES').length} |`,
  `| 2단계 언론사 부족 | ${c.results.filter((r) => r.status === 'INSUFFICIENT_PUBLISHERS').length} |`,
  `| 기존 공개 이슈 중복 | ${c.results.filter((r) => r.status === 'DUPLICATE').length} |`,
  `| 3단계 생성 완료 | ${generated.length} |`,
  `| 3단계 본문 부족 | ${g.results.filter((r) => r.status === 'INSUFFICIENT_BODIES').length} |`,
  `| 수집한 본문 (이슈별 합계) | ${g.results.reduce((n, r) => n + r.articles.length, 0)} |`,
  '',
  ...(v
    ? [
        `- 4단계 통과 ${v.results.filter((r) => r.status === 'PASSED').length} / 보류 ${v.results.filter((r) => r.status === 'HELD').length}`,
        '',
      ]
    : []),
  '## 토큰과 추정 비용',
  '',
  '| 단계 | 호출 | 입력 토큰 | 출력 토큰 | 추정 비용 (USD) |',
  '| --- | ---: | ---: | ---: | ---: |',
];
for (const [label, s] of phases) {
  const cost = estimateCost(s.usage);
  lines.push(
    `| ${label} | ${s.usage.length} | ${s.usage.reduce((n, u) => n + (u.inputTokens ?? 0), 0)} | ${s.usage.reduce((n, u) => n + (u.outputTokens ?? 0), 0)} | $${cost.usd.toFixed(4)}${cost.incomplete ? ' (누락 있음)' : ''} |`,
  );
}
const cost = estimateCost(phases.flatMap(([, s]) => s.usage));
lines.push(
  '',
  `- 전체 추정 비용: **$${cost.usd.toFixed(4)} USD**`,
  '- gpt-5.4-mini-2026-03-17, 2026-09-20 확인 단가: 100만 토큰당 입력 $0.75 / 캐시 입력 $0.075 / 출력 $4.50.',
  '- [공식 단가](https://developers.openai.com/api/docs/models/gpt-5.4-mini). 1·2단계는 캐시 사용량 미기록으로 일반 입력 단가 적용, 3·4단계는 기록된 캐시 할인 적용. 세금·환율·다른 실행 및 개발 테스트 비용 제외.',
  `- 사용량 누락: ${cost.incomplete ? '있음, 확인된 사용량만 합산' : '없음'}. 실패 후 재개 시 기록된 실패 호출도 포함합니다.`,
  '',
  '## 이슈별 처리 결과',
  '',
  '| 검색용 제목 | 3단계 상태 | 본문 | 관점 |',
  '| --- | --- | ---: | ---: |',
);
for (const r of g.results)
  lines.push(
    `| ${r.source.candidate.title.replaceAll('|', '\\|')} | ${r.status} | ${r.articles.length} | ${r.draft?.viewpoints?.length ?? 0} |`,
  );
lines.push(
  '',
  '## 1단계 제외 후보',
  '',
  ...(d.excludedCandidates ?? []).map(
    (e) => `- ${e.candidate.title}: ${e.reason === 'HYPERLOCAL' ? '지엽적 이슈' : '관련성 낮음'}`,
  ),
);
const details = resolve(dirname(reportFile), 'news-generation-details.md');
const finalGeneration = v
  ? {
      ...g,
      results: g.results.map(
        (r) =>
          v.results.find((item) => item.original.source.candidate.id === r.source.candidate.id)
            ?.current ?? r,
      ),
    }
  : g;
await writeGenerationReport({ id: '전체 실행 결과', snapshot: finalGeneration }, details);
const detailText = await readFile(details, 'utf8');
lines.push('', detailText.slice(detailText.indexOf('## 생성 결과')));
if (v) {
  const validationDetails = resolve(dirname(reportFile), 'news-validation-details.md');
  await writeValidationReport(
    { id: '전체 실행 결과', generationRunId: '원본 JSON 참조', snapshot: v },
    validationDetails,
  );
  lines.push('', await readFile(validationDetails, 'utf8'));
}
await writeFile(reportFile, lines.join('\n') + '\n');
console.log(JSON.stringify({ report: resolve(reportFile), generated: generated.length, cost }));
