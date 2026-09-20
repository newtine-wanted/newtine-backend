import { writeFile } from 'node:fs/promises';
import { estimateCost } from '../dist/apps/batch/src/generation/generation.policy.js';
export async function writeGenerationReport(run, path) {
  const s = run.snapshot;
  const cost = estimateCost(s.usage);
  const clean = (v) => String(v).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = [
    '# 3단계 생성 결과',
    '',
    `- 실행: ${run.id}`,
    `- 기준 시각: ${s.at}`,
    '- 검증·공개 전 초안입니다. 이해관계자 관점은 서로 대치하지 않아도 반드시 2개 작성합니다.',
    '',
    '## 토큰과 추정 비용',
    '',
    '| 호출 | 입력 토큰 | 출력 토큰 | 추정 비용 (USD) |',
    '| ---: | ---: | ---: | ---: |',
    `| ${s.usage.length} | ${s.usage.reduce((n, u) => n + (u.inputTokens ?? 0), 0)} | ${s.usage.reduce((n, u) => n + (u.outputTokens ?? 0), 0)} | ${cost.incomplete ? '산정 불가/일부 누락' : '$' + cost.usd.toFixed(4)} |`,
    '',
    `- 사용 모델: ${[...new Set(s.usage.map((u) => u.model))].join(', ')}.`,
    '- 기본 모델 gpt-5.4-mini-2026-03-17에만 적용하는 2026-09-20 단가: 100만 토큰당 입력 $0.75, 캐시 입력 $0.075, 출력 $4.50.',
    '- [공식 단가](https://developers.openai.com/api/docs/models/gpt-5.4-mini). 세금·환율·별도 서비스 요금 제외. 이 실행에 기록된 실패 호출도 포함하며 이전 단계·별도 테스트 비용은 제외합니다.',
    `- 사용량 누락: ${cost.incomplete ? '있음 — 비용은 확인된 부분만 합산' : '없음'}. 캐시 할인: ${cost.cacheDiscountUnknown ? '일부 기록이 없어 해당 입력은 일반 단가 적용' : '기록된 캐시 토큰에 적용'}.`,
    '',
    '## 생성 결과',
    '',
  ];
  for (const r of s.results) {
    lines.push(
      `### ${clean(r.draft?.title ?? r.source.candidate.title)}`,
      '',
      `- 상태: ${r.status ?? '진행 중'}`,
      `- 본문 확보: ${r.articles.length}개 / 실패: ${r.fetchFailures.length}개`,
    );
    if (r.draft) {
      lines.push(
        `- 사건 시각: ${r.eventAt ?? '미확정'} (${r.eventAtSource ?? '미확정'})`,
        `- 분류: ${JSON.stringify(r.classification)}`,
        `- 점수: ${JSON.stringify(r.scores)}`,
        `- LLM 추정 중요도 근거: ${r.draft.importanceReason}`,
        `- 규칙으로 확정한 분류: ${JSON.stringify(r.rules)}`,
        '',
        '#### 요약 본문',
        '',
        r.draft.integratedSummary,
        '',
        '#### 핵심요약 (3줄)',
        ...r.draft.summaryLines.map((line) => `- ${line}`),
        '',
        '관점:',
        ...(r.draft.viewpoints ?? []).map((v) => `- ${v.stakeholder}: ${v.statement}`),
        '',
        '세대별 영향:',
        ...r.draft.impacts.map((i) => `- ${i.generation}: ${i.description}`),
        '',
        '용어:',
        ...(r.glossary ?? []).map((t) => `- ${t.term}: ${t.definition} (${t.source})`),
        '',
        `후속 추적: ${JSON.stringify(r.draft.followUp)}`,
      );
    }
    lines.push(
      '',
      '근거 기사:',
      ...r.articles.map(
        (a) => `- [${a.title.replaceAll('[', '\\[').replaceAll(']', '\\]')}](${a.sourceUrl})`,
      ),
      '',
    );
  }
  await writeFile(path, lines.join('\n') + '\n');
}
