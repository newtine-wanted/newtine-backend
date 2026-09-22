# 첫 피드 조회 개선 — 실행 계약

# 이전 실행 계약 안내

2026-09-21부터 이 문서는 최초 설계의 보조 실행 계약으로 보관한다. 현재 구현 기준은 [robust 설계](feed-first-page-latency-design.html)와 [구현 제어 문서](feed-first-page-latency-implementation.html)다. 특히 새 세션 fast path, typed recommendation/card projection, canonical save outcome, low-cardinality stage diagnostics 범위가 추가되었으므로 이 파일의 이전 scope·검증 상태를 현재 구현 지시로 사용하지 않는다.

## 상태와 시작 조건

- 이 파일은 설계 승인 당시 확정한 **구현 실행 계약**이다. 실제 as-built·검증·리뷰 상태는 [구현 제어 문서](feed-first-page-latency-implementation.html)에 기록한다.
- [설계 기준](feed-first-page-latency-design.html): `b6b90e2`, 2026-09-21. 구현 승인됨.
- 구현 worktree: `/Users/hyunseok/.codex/worktrees/feed-first-page-latency/newtine-backend`, 현재 detached worktree. 원본 main의 무관한 변경은 가져오거나 수정하지 않았다.
- 사용자가 설계를 승인하고 구현을 요청했으며, 이 계약에 따라 구현했다. 커밋·push·배포는 별도 범위다.
- 역할: Luna max, 단일 write owner. 새 판단이 필요한 경우 구현을 중단하고 상위 설계 판단으로 돌린다. 구현 후 별도 no-write critical review를 수행한다.
- 승인 후 `feed-first-page-latency-implementation.html`에 승인 범위·실제 변경·검증·미검증을 기록했다. 설계 문서를 구현 완료 기록으로 바꾸지 않는다.

## Goal / 목표

사용자별 사전 생성 없이 새 세션 첫 페이지를 빠르게 응답한다. 서버 HTTP p95 ≤500ms가 검증 목표다. 이후 미생성 배치도 동일 개선 경로를 이용한다. 이미 저장된 배치는 추천하지 않으므로 읽기 경량화만 적용된다.

지금은 속도 개선률·p95 달성을 주장할 수 없다. 추천 함수 ≤50ms p95는 내부 CPU 예산 목표일 뿐 전체 HTTP 목표의 대체물이 아니다.

## Observed evidence / 확인된 근거

- `issueRecommendation.ts`: 선택된 최대 10개의 순열을 재귀 탐색하고 대안별 반복. 기존 per-alternative 제한은 전체 요청의 계산량 제한이 아니다.
- 앞선 로컬 합성 단일 실행(후보100): 다양한 주제 약45ms, 앞60개 동일 주제 약1,746ms. 생산 환경 추정이나 p95가 아니다.
- `issueCardQuery.repository.ts`: `includeArticles=false`도 기사 링크 → 기사 → 언론사 전체를 읽어 주로 개수만 사용한다.
- 제공된 단일 SQL 실행3.258ms와 HTTP24~28초만으로 풀 대기/콜드 스타트/다른 쿼리의 영향 비율을 확정할 수 없다.
- 기존 PR18의 짧은 저장 transaction, canonical 경쟁 승자, 확정 후 카드 재조회는 보존 대상이다.

## Decisions / 제안한 선택

### A. v2 계산 상한

1. v1의 scoring/eligibility/희소 유형 quota matching을 유지한다. v1 경로는 동작 그대로 보존한다.
2. v2에서는 matching seed 최대10개와 전체 예산 B개 각각으로 두 개의 결정적인 greedy incumbent를 만든다. 이전 run을 초기 상태로 삼고 매 단계 canAppend와 중복을 확인한다.
3. 전체 pool 경로도 seed를 우선하되 막혔을 때 B개 전체에서 대안을 고려한다. 다음 항목 우선순위는 seed 포함 → 미충족 quota 기여 → 점수 → ID. seed selectedType 유지, 추가 후보 selectedType은 eligibleTypes 중 quota 미충족 우선 → 기존 유형 우선순위. 출력 reasonCodes 일치.
4. 두 greedy를 **모두 만든 뒤** 길이 → capped quota → 점수 → ID로 비교한다. 10개면 종료한다. quota가 부족해도 최적 10개를 찾기 위해 더 탐색하지 않는 절충이다. 두 greedy의 후보 검사 상한은 20B(B≤500); 정렬은 바깥에서 한다.
5. 둘 다 짧으면 초기 seed와 대안 순서 탐색에 **공유 transition10,000회 / replacement proposal24개** 상한을 둔다. 기존의 대안 생성·교체 우선순위는 재사용하되 전체 후보 검사도 유한해야 한다. proposal마다/round마다 예산을 재설정하지 않는다.
6. transition 시도는 memo/제약으로 거절되어도 센다. 초기 진입·루프·대안 생성에 무한/무계수 우회가 없어야 한다. 부분 memo를 완전 탐색 증명으로 재사용하지 않는다. 잘린 경로는 cut을 상위로 전달한다.
7. 유효한 incumbent보다 나빠지지 않는 결과를 반환한다. 단위 테스트용 diagnostics로 카운터를 검증하되 HTTP 응답/운영 로그를 늘리지 않는다. 시간 제한용 Promise.race나 wall-clock 중단 금지.
8. 10,000/24는 검증 전 초기 설계값. fixture를 통과시키려고 몰래 늘리거나 품질 assertion을 낮추지 않는다. 실패하면 원인·최소 재현과 함께 설계로 돌린다.

### B. 종료 상태의 증명

- 10개면 CONTINUE.
- 10개 미만이고 candidate sentinel 또는 탐색/교체 생략으로 가능성이 남으면 SEARCH_LIMITED. 상한 미도달도 exhaustive의 증거가 아니다.
- sentinel 없이 모든 eligible pool을 반환하고 10개 미만이면 EXHAUSTED.
- 후보가 남은 CONSTRAINT_LIMITED 증명은 다음만 허용: 전체 eligible pool≤10이고 예산 안에서 전체 순서 최대 길이를 확인한 경우, 또는 전체 pool이 동일 non-null topic/representative entity여서 이전 run을 반영한 길이 상한을 계산하고 달성한 경우. 전체 pool이 작은 경우 선택된 일부가 아닌 전체 pool로 증명해야 한다.
- 이 외의 짧은 heuristic 결과는 SEARCH_LIMITED. 기존 API의 제한 상태에는 nextCursor가 없고 새 배치409이므로 이를 불필요하게 늘리지 않도록 품질 회귀를 검증한다. API의 재시도 정책 자체는 바꾸지 않는다.

### C. 최소 repository 경량화

- `loadIssueRecords(feed | detail)`로 명시. `findCandidates`, `findIssuesByIds`는 feed; `findIssue`는 detail.
- IssueRecord 반환형 및 모든 기존 필드의 의미 유지. 후보 summary/impacts 등은 여전히 읽는다. 최종10개만 hydrate하는 DTO 재설계는 이번 범위 아님.
- feed의 article links/full article/publisher 로딩을 매개변수화된 ORM query-builder grouped count로 대체한다. raw scalar 결과를 사용한다. AVAILABLE 기사만 링크 수를 세고 issue별0 기본값. 숫자 변환·중복 JOIN 방지.
- detail의 기사 순서·내용·publisher fallback은 그대로.
- candidate slice에서 raw ID만 조회한다. partial managed entity를 identity map에 남기지 않는다. 기존 where/order/limit, slice 순서, seenIds, budget+1 sentinel, 후처리 public filter를 유지한다. 새 raw SQL 경계가 필요하면 자동 확장하지 말고 에스컬레이션.
- 저장 후 bulk 카드 재조회와 현재 공개 조건 검사는 유지한다. 후보 단계 객체를 캐시해서 바로 응답하지 않는다.

### D. 버전·활성화

- 기존 text algorithm_version 사용; migration 없음. `FeedAlgorithmSnapshot`에 생성 시 알고리즘 버전 전달. 실제 repository와 in-memory fixture의 hardcoded v1 생성 위치 모두 수정.
- 환경 `RECOMMENDATION_ALGORITHM_VERSION`: 지원 값 `issue-card-query-v1 | issue-card-query-v2`, 기본 v2. 잘못된 명시값은 초기화 실패. 설정은 새 세션 생성에만 사용.
- 저장 batch fast path 뒤, **새 배치 계산 전** session.algorithmVersion으로 dispatch. 기존 세션의 후보 예산/threshold snapshot도 유지. 미지원 버전은 기존 FeedBatchConflict, 저장된 결과는 기존 검증 후 재사용.
- 호환 코드(v1/v2, 기본v2)를 모든 트래픽에 반영한다. 새 세션은 v2로 생성하고, 기존 v1 세션은 저장된 snapshot으로 v1을 계속 사용한다. 혼합된 오래된 revision에 새 v2 세션이 가지 않도록 호환 revision 배포를 먼저 완료한다.
- rollback은 신규 생성 버전만 v1로 바꾸고 v2 실행 코드 유지. 마지막 v2 생성부터24h TTL + 진행 요청 종료 확인 전 v2 미지원 바이너리로 복귀 금지.
- v2 기본값 변경은 사용자 승인으로 구현 범위에 포함한다. 실제 배포 실행과 운영 p95 달성 판정은 여전히 별도 운영 승인·검증 대상이다.

## Scope / 파일·경계

- `apps/api/src/issue/recommendation/issueRecommendation.ts` 및 필요시 같은 디렉터리 v2 전용 모듈: v1 보존·v2·내부 diagnostics.
- `apps/api/src/issue/issueFeed.service.ts`: 생성 버전 전달·저장 버전 dispatch만. transaction 경계와 이력/후속 조회 정책 유지.
- `apps/api/src/issue/repository/issueCardQuery.repository.ts`: feed/detail·집계·ID projection·세션 버전 저장.
- `libs/core/src/issue/repository/type/issueQuery.repository.ts`: 알고리즘 snapshot version; 필요한 export만 `libs/core/src/index.ts`.
- `test/fixtures/issue/inMemoryIssueQuery.repository.ts`, 관련 최소 test doubles: 버전 stamp. 테스트 기본 v1/v2 의도를 명시.
- `test/unit/issueCardQuery.test.ts`, `issueCardQuery.repository.test.ts`, `inMemoryIssueQuery.repository.test.ts`, 새 `test/unit/issueRecommendationV2.test.ts`.
- 필요한 실제 PG regression은 `scripts/compose-issue-data-smoke.mjs`의 격리된 로컬 smoke 경계 안에서 추가.
- 새 예정 파일 `scripts/benchmark-feed-recommendation.mjs`, `scripts/benchmark-feed-first-page.mjs`: 성능 증거. 아직 존재하지 않는다.
- 설정 문서는 기존 환경 설정 문서의 적절한 위치에 위 버전 설정만 추가. 비밀값을 복사하지 않는다.
- 상기 설계/인계/승인 후 구현 제어 문서. 다른 report/auth/schema 변경은 범위 밖.

## Invariants / 필수 보존

최대10·중복 없음, 사용자별 interaction·이전 배치 제외, public 조건/정규화, 소유권/만료, 동일 주제/인물3연속 금지(배치 경계 포함), null run 의미, 선택 유형 적격성, LIKE/verified FOLLOW_UP/엄격한 eventAt 관계, 저장 winner·멱등·rollback. 새 락이나 조회 전체 transaction 금지.

## Steps / 구현 순서

1. 승인·기준 커밋·작업 상태 확인. 기존 fixture와 동일 입력 benchmark baseline 확보.
2. v1 보존과 v2 카운터/결정적 탐색 구현 및 단위 회귀. first valid10 반환의 품질 절충을 테스트에 명시.
3. session version stamp/dispatch/config validation 구현. 저장 fast path·혼합 세션 회귀.
4. repository 경량화. 실제 SQL projection·집계·identity-map·detail 회귀.
5. 아래 focused/full 검증. 격리된 benchmark에서 원인 구간과 전체 HTTP 확인.
6. independent no-write review. diff/hash/status 전후 확인. 결과와 미검증을 구현 제어에 기록. 커밋/PR/배포는 사용자 요청 범위 확인 후 별도로 진행.

## Acceptance / 완료 기준

- v1 기존 테스트 유지. v2 별도 테스트: 결정성·상한·cut/memo·정직한 상태·공개/소유권/연속·희소 quota.
- 기존 품질 회귀: rare personalized4 보존, 처음10 편중+뒤10 다양에서10, 처음110 편중+뒤10 다양(B120)에서10, 복합 제약8개 fixture 유지. 만족 못 하면 실패이지 테스트 변경 사유가 아니다.
- DB count: AVAILABLE/REMOVED/UNAVAILABLE 혼합,0개,다수 기사,여러 impacts/entities,순서,부분 projection 후 detail 로딩 검증.
- v1/v2 저장 재요청 동일, 동시 생성 승자 동일, 현재 공개 상태 재확인. 기존 v1 세션 미생성 배치의 비용은 TTL까지 남는다고 보고.
- 성능: 각 대표 데이터군에서 첫 서버 HTTP p95≤500ms 측정. 미달이면 미완료/미달로 보고한다. 기능 통과와 성능 통과를 분리한다.

## Verification commands / 검증 명령

기존 명령(이 설계 단계에서는 실행하지 않음):

```sh
npm run test:jest -- test/unit/issueCardQuery.test.ts test/unit/issueCardQuery.repository.test.ts test/unit/inMemoryIssueQuery.repository.test.ts test/unit/feedCursor.test.ts
npm run typecheck
npm run format:check
npm run lint
npm test
npm run build
npm run contracts:check
node scripts/check-generated.mjs
```

v2 파일 생성 후 정확한 focused 명령:

```sh
npm run test:jest -- test/unit/issueRecommendationV2.test.ts test/unit/issueCardQuery.test.ts test/unit/issueCardQuery.repository.test.ts test/unit/inMemoryIssueQuery.repository.test.ts
```

PostgreSQL smoke는 loopback의 폐기 가능한 `issue-card-query-smoke` DB임을 확인하고 기존 compose 절차로 준비한 뒤 `npm run test:smoke:compose:data`. 운영/공유 DB에는 실행하지 않는다. 환경 준비 불가 시 mock으로 대체 통과하지 말고 미검증으로 남긴다.

예정 benchmark interface(스크립트 구현 후에만 실행 가능):

```sh
node scripts/benchmark-feed-recommendation.mjs --samples=200
node scripts/benchmark-feed-first-page.mjs --samples=200 --concurrency=1,5,10
```

- recommendation harness: 실제 production 함수를 사용, 고정 fixture/seed, 후보10/100/500, 게스트/회원·편중/다양/교차 제약. v1/v2 같은 입력, warmup 별도, elapsed+CPU+p50/p95/p99+작업량+카드수/상태 보고.
- HTTP harness: 매번 cursor 없는 새 세션, 실제 DB/서비스/인증 경로. 회원 이력0/1,000/10,000, B100/500, 게스트/회원, 다양한/편중, 동시1/5/10의 대표 셀별≥200회. 저장 batch 반복 측정으로 첫 조회를 대체하지 않음.
- 테스트 URL은 명시적인 loopback 또는 승인된 폐기 가능한 비운영 환경 allowlist만. fixture 소유 범위 밖 데이터 쓰기/정리 금지. token은 승인된 테스트 자격증명으로 전달하되 출력하지 않음.
- 1CPU/512MB와 DB RTT 등 배포 유사 조건 기록. 서버 p95와 외부 클라이언트 RTT 구분. cold/warm을 섞지 않음. warm 결과만 있으면 cold first request 목표는 미검증.
- 테스트 전용 구간 측정은 메모리에서 수집하고 집계만 출력. 추천·조회·저장 시간의 p95를 더하지 말고 전체 경과를 직접 측정. 로그에 SQL/ID/token/본문 없음.

## Forbidden changes / 금지

사용자별 사전 생성/캐시, Redis/worker/DB migration, 무제한 Promise.all, pool/concurrency/인프라 설정 변경, 운영 per-query 로그, 후보 예산 축소로 빠른 척하기, 제약 완화·원인 모르는 retry·상태 거짓 분류, 기존 session 버전 무시, API 계약 변경, 최종 공개 재확인 생략.

## Escalate when / 중단하고 설계로 복귀

- 상한 내에서 품질 fixture를 유지할 수 없음 또는 SEARCH_LIMITED가 기존 대비 증가.
- ORM projection으로 identity map/정규화 차이 발생, raw SQL 경계 또는 DTO 대수술 필요.
- 환경·관측이 예상과 다르거나 실제 병목이 다른 구간이며 추가 변경이 필요.
- API·state·락·snapshot·활성화/rollback 정책 변경 필요.
- 지원 버전이 실제 운영 세션과 다르거나 사전 호환 배포 조건을 충족할 수 없음.

## Open uncertainties / 남은 불확실성

상한값의 충분성, 실제 첫 HTTP 개선폭, DB 왕복/인증/이력 규모/콜드 스타트 비중은 미측정이다. 이 계약은 조사·설계 결과이며 성능 보증이 아니다. 필요하면 측정 후 별도 DTO/배치 조회 설계를 승인받는다.
