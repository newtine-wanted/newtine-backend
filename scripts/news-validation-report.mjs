import { writeFile } from 'node:fs/promises';
import { estimateCost } from '../dist/apps/batch/src/generation/generation.policy.js';
export async function writeValidationReport(run, path) {
  const s = run.snapshot;
  const cost = estimateCost(s.usage);
  const lines = [
    '# 4단계 생성 결과 검증',
    '',
    `- 검증 모드: ${s.aiValidationEnabled === false ? '규칙 전용 (AI 검증·재생성 비활성화)' : '규칙 + AI'}`,
    `- 실행 ID: ${run.id}`,
    `- 생성 실행 ID: ${run.generationRunId}`,
    `- 통과 ${s.results.filter((r) => r.status === 'PASSED').length} / 보류 ${s.results.filter((r) => r.status === 'HELD').length}`,
    `- 최초 통과 ${s.results.filter((r) => r.status === 'PASSED' && !r.repair).length} / 수정 후 통과 ${s.results.filter((r) => r.status === 'PASSED' && r.repair).length} / 수정 시도 ${s.results.filter((r) => r.repair).length}`,
    '- 독립 취재 근거 최소 2개 조건은 사용하지 않습니다. 5단계 저장·공개는 수행하지 않았습니다.',
    `- 호출 ${s.usage.length}회, 입력 ${s.usage.reduce((n, u) => n + (u.inputTokens ?? 0), 0)} / 출력 ${s.usage.reduce((n, u) => n + (u.outputTokens ?? 0), 0)} 토큰, 추정 $${cost.usd.toFixed(6)} USD${cost.incomplete ? ' (사용량 누락 있음)' : ''}`,
    '',
    '## 이슈별 판정',
    '',
  ];
  for (const r of s.results) {
    lines.push(
      `### ${r.current.draft?.title ?? r.original.source.candidate.title}`,
      '',
      `- 최종: ${r.status}`,
      `- 수정 필드: ${r.repair?.fields.join(', ') || '없음'}`,
    );
    if (r.termLimit)
      lines.push(`- 용어 3개 상한 적용으로 제외: ${r.termLimit.removedTerms.join(', ')}`);
    if (r.repair?.error) lines.push(`- 수정 오류: ${r.repair.error}`);
    for (const v of r.reviews) {
      const findings = [...v.rules, ...(v.semantic?.findings ?? [])];
      lines.push(`- ${v.phase}: ${findings.length ? `${findings.length}개 실패` : '통과'}`);
      for (const f of findings)
        lines.push(`  - ${f.field} (${f.category}): ${f.reason} [${f.articleIds.join(', ')}]`);
    }
    for (const p of r.repair?.patches ?? []) {
      const before =
        p.field === 'classification' || p.field === 'glossary'
          ? r.original[p.field]
          : r.original.draft?.[p.field];
      const after =
        p.field === 'classification' || p.field === 'glossary'
          ? r.current[p.field]
          : r.current.draft?.[p.field];
      lines.push(
        '',
        `**${p.field} 수정 전**`,
        '',
        '```json',
        JSON.stringify(before, null, 2),
        '```',
        '',
        '**수정 후**',
        '',
        '```json',
        JSON.stringify(after, null, 2),
        '```',
      );
    }
    lines.push('');
  }
  await writeFile(path, lines.join('\n') + '\n');
}
