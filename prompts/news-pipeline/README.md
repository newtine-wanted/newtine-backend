# 뉴스 파이프라인 LLM 프롬프트

코드를 수정하지 않고 이 폴더의 Markdown을 편집한다. 실행은 저장소 루트에서 시작한다.

| 파일 | 용도 |
| --- | --- |
| discovery-extract.md | 기사 제목에서 검색어당 후보 최대 3개 선정 |
| discovery-extract-limits.md | 후보 수·기사 번호 범위 |
| discovery-finalize.md | 전체 후보의 무관·지엽적 이슈 제외 및 중복 통합 |
| discovery-follow-up.md | 추적 이슈의 새 전개 확인 |
| collection-duplicates.md | 기존 공개 이슈 중복 검사 |
| collection-relevant.md | 대표 기사 기준 같은 사건의 기사 선별 |
| generation-generate.md | 요약·세대 영향·관점 2개·중요도·후속 추적 생성 |
| generation-classify.md | 규칙으로 확정하지 못한 DB 분류 선택 |
| generation-define.md | 사전에 없는 용어 설명 생성 |

`{{limit}}`, `{{maxIndex}}`, `{{maxTrackingDays}}`, `{{uxWriting}}`은 실행 시 코드가 채운다.
UX 가이드 원본은 `docs/news-pipeline/direction/ux-writing.md`이며 생성·용어 프롬프트에 삽입한다.
기존 공통 worker의 설정(`config/pipeline-ai.yml`)은 이번 독립 파이프라인과 별개다.

- `validation-review.md`: 기사 사실·모순·UX 검증. 독립 취재 근거 개수 조건 없음.
- `validation-repair.md`: 실패 필드 및 연결 필드만 1회 수정.
