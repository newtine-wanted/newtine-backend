# 데이터·응답 계약

아래 JSON 형태와 처리 순서는 ERD v1.2의 설계 기본안이다. 실제 OpenAPI/JSON Schema나 실행 코드는 아니다. URL 경로·페이지네이션·오류 응답은 구현 전에 확정한다.

## 상세 JSON

`integrated_summary`는 카드의 1줄 요약이다. `summary_lines`는 문자열 3개다. `viewpoints`는 확인된 주장 목록이며 없으면 NULL, `glossary`는 없으면 빈 배열이다.

```json
{
  "integrated_summary": "핵심 사실을 설명하는 한 문장",
  "summary_lines": ["핵심 사실", "주요 쟁점", "확인된 영향"],
  "viewpoints": [
    {"statement": "기사에서 확인한 주장", "article_ids": ["근거 article_id"]}
  ],
  "glossary": [
    {"term": "용어", "definition": "설명", "article_ids": ["근거 article_id"]}
  ]
}
```

예시 ID는 자리표시자다. 실제 요청에서는 유효한 UUID이며 현재 이슈의 issue_articles에 연결된 근거여야 한다. JSON 내부 참조는 DB FK로 보호되지 않는다. 관점을 사용자 성향이나 임의 찬반 비율로 만들지 않는다. 본문·문단 해시가 영속 저장된다고 가정하지 않는다.

## 행동 수용

- event_type: LIKE / SKIP / PASS. dwell_time: 밀리초(ms), 0 이상, 미측정 NULL.
- 클라이언트가 같은 이벤트를 재전송할 때 동일 id를 유지하는 계약이 필요하다. client_event_id를 별도로 만들지 않는다.
- 서버는 인증된 user_id를 사용한다. 기존 id와 대상·행동이 다른 요청은 충돌로 거절한다.
- 설계 기본안: 사용자 행 잠금 안에서 중복 id와 직전 행동을 확인하고, 이벤트 저장과 선호 반영을 한 트랜잭션으로 처리한다.
- previous_action은 서버가 확인한 값이며 최초 NULL이다. 클라이언트가 보내는 직전 값으로 현재 상태를 덮어쓰지 않는다.
- 최신 행동은 서버 created_at 순서다. 같은 사용자·이슈의 서로 다른 이벤트가 같은 시각이 되지 않도록 잠금 안에서 직전 시각보다 큰 시각을 부여하는 기본안이다. 시각 정밀도·동률 처리 계약은 구현 전에 확인한다.
- 클라이언트 발생 순서 복원은 보장하지 않는다. 네트워크 순서가 바뀌면 서버 수용 순서를 따른다.
- 동일 id 재전송은 점수를 다시 적용하지 않는다. 다른 id로 반복하는 동일 행동·전환의 가중치 정책은 추천 계약에서 확정한다.

현재 관심 목록은 사용자·이슈별 최신 행동이 LIKE인 이슈다. SKIP/PASS로 변경되면 제외된다. GET /feed만으로 이벤트를 생성하지 않는다. 무행동 열람까지는 현재 모델로 알 수 없다.

## 지난주 보고서

기간은 `[period_start 월요일 00:00, period_end 다음 월요일 00:00)` KST다. 입력은 기간 안에 LIKE를 표시했고, 종료 직전 최신 행동이 LIKE인 이슈다. 이슈당 한 번 집계한다.

| 사례 | 집계 |
| --- | --- |
| 일요일 LIKE → 월요일 SKIP | 지난주 포함, 현재 관심 목록 제외 |
| 일요일 LIKE → 일요일 SKIP | 지난주 제외 |
| 이전 주 LIKE만 유지, 지난주 LIKE 이벤트 없음 | 지난주 신규 관심 입력에서 제외 |
| 일요일 클라이언트 행동이 월요일 서버에 도착 | 지난주 소급 제외 |

사용자 신청 시 입력 스냅샷을 저장하고 접수한다. API는 생성 완료를 기다리지 않으며 별도 reportWorker가 DB 대기열을 처리한다. `UNIQUE(user_id, period_start)`로 한 행을 유지하고 QUEUED → RUNNING → SUCCEEDED/FAILED로 처리한다. 성공한 보고서는 다시 생성하지 않는다. 선점은 SKIP LOCKED, 완료·실패·heartbeat는 attempt와 leaseToken 조건부 저장이다. 만료된 lease는 회수할 수 있으며 토큰 교체 뒤 옛 결과는 저장되지 않는다.

```json
{
  "analysis_status": "READY",
  "issue_count": 12,
  "category_counts": [{"category_code": "finance", "count": 7}],
  "connections": [
    {
      "title": "주거 부담을 줄이는 두 접근",
      "description": "관심 이슈들의 공통 쟁점과 차이를 설명하는 내용",
      "issue_ids": ["집계 대상 issue_id A", "집계 대상 issue_id B"]
    }
  ]
}
```

- analysis_status: READY / INSUFFICIENT_DATA / NO_CONNECTION. 작업 status와 다르다.
- 표본 5건 미만 또는 연결 근거 부족은 안내 결과로 성공 처리할 수 있다.
- connections의 근거 ID는 해당 사용자의 해당 주차 입력 집합 안에 있어야 한다.
- category_counts의 합계는 issue_count와 같아야 한다. 추천 weight를 비율 계산에 사용하지 않는다.
- SUCCEEDED는 content 저장과 같은 트랜잭션에서 반영한다.
- 최초 성공 결과는 고정한다. 신청 트랜잭션에서 기간 입력·분류·검증 상세를 고정하고 실패 재시도에도 재사용한다. 추천 후보는 최초 worker 조회 시 별도 시각과 함께 고정한다.
- 조회는 사용자 소유 조건과 SUCCEEDED를 확인한다. 최근 4주 조회는 보존 기한이 아니다.
- 분석 근거가 공개 중단되면 이를 인용한 분석 문장을 숨기거나 안내로 대체한다.

## 함께 살펴볼 이슈·주요 이슈

| 기능 | 후보·필터 | 저장·한계 |
| --- | --- | --- |
| 함께 살펴볼 이슈 | 관심 이슈 임베딩 검색 → 자기 자신/비공개/행동 이력/내용 중복 제외 | 검색 유사도는 의미 관계의 확정값이 아님 |
| 관심 분야 주요 이슈 | 해당 보고서의 최다 관심 분야 → 분석 대상 주 공개 주요 후보 → 행동·근거·추천 중복 제외 | 공동 1위 모두 포함, 최대 5개. 성공 결과에 고정하며 다른 분야로 자동 대체하지 않음 |

분석 근거와 추천 대상은 서로 다른 집합이다. 추천 이슈를 `connections.issue_ids`에 넣지 않는다. 추천 결과는 content의 별도 필드에 고정한다. 공개 중단 또는 이후 행동이 있는 추천은 조회에서 숨기므로 개수는 줄 수 있다. 분석 0건은 NO_INTEREST, 최다 분야에 후보가 없으면 NO_CANDIDATES 안내를 제공한다.

## 조회 인덱스 기본안

실측 전 후보이며 모두 무조건 추가하는 목록이 아니다.

| 조회 | 후보 |
| --- | --- |
| 공개 피드 | issues(publication_status, published_at, id) |
| 분류별 조회 | issues(category_code, published_at) |
| 기사에서 이슈 역조회 | issue_articles(article_id, issue_id) |
| 이전 이슈 조회 | issue_relations(to_issue_id) |
| 최신 행동 | user_interaction_events(user_id, issue_id, created_at) |
| 주간 행동 | user_interaction_events(user_id, created_at) |
| 보고서 | weekly_reports(user_id, period_start) 복합 UNIQUE 활용 |
| job 선점 | issue_content_jobs(status, created_at, id), 활성 job 부분 UNIQUE |
| 호출 집계 | ai_usage_records(created_at), (issue_content_job_id, started_at) |
| 벡터 검색 | 모델·차원 고정 후 정확 검색 품질·지연 측정. 이후 근사 인덱스 검토 |

## AI 사용량

호출 ledger의 목표 상태는 호출 시작 RUNNING, 결과 확인 후 SUCCEEDED/FAILED, 결과 불명 UNKNOWN이다. 현재 provider 호출 기록은 종료 시점에 결과를 확인할 수 있는 HTTP/provider 오류를 FAILED로, timeout·전송 오류처럼 결과 자체가 불명확한 경우를 UNKNOWN으로 기록한다. pre-call RUNNING row와 finalize/recovery는 G26-B 후속 범위다. actual_cost는 USD 추정 비용이며 최종 청구액과 다를 수 있다. 비용/토큰 미확인은 NULL이다. SEARCH/FETCH는 model/토큰이 NULL일 수 있다.

이슈 job 외 호출은 job FK가 NULL이므로 진단보고서 호출에는 별도 weekly_report_id를 추가해 보고서와 연결한다. 보고서 호출은 pre-call RUNNING을 기록하고 완료 시 같은 usage ID를 SUCCEEDED/FAILED/UNKNOWN으로 확정한다. 기간·operation·provider 집계는 가능하다. 별도 예산 예약 없이 강한 동시 지출 상한이 보장된다고 해석하지 않는다.

## 삭제·보존 기본안

| 대상 | 규칙 |
| --- | --- |
| 회원 | 세션·선호·행동·보고서 함께 삭제. 공유 이슈·기사·대상은 유지 |
| 공개 이슈 | 우선 publication_status로 공개 중단. 물리 삭제는 연결·행동·후속·작업·보고서 JSON 참조 검토 후 수행 |
| 기사·언론사 | 공개 근거 참조가 있으면 삭제 제한. 원문 제거는 source_status로 표현 |
| 상세·벡터 | 부모 이슈 삭제가 허용된 경우 종속 삭제 가능 |
| 대상·분류 | 사용 중 삭제 제한. 대상은 is_active=false로 신규 선택 중단 가능 |
| job | 삭제 시 사용량 job FK는 SET NULL로 유지하는 기본안 |
| 본문 | 영구 저장 테이블이 없으므로 기존 30일/7일 본문 정리 정책 적용 안 함 |
| 이벤트 | 최신 행동까지 일괄 기간 삭제하면 관심 목록이 소실됨. 보존 정책 결정 전에 상태 유지 방식 확인 |

기간별 보존값은 미확정이다. FK 삭제 동작은 실제 DDL 작성 시 명시하고 검증한다.

### 보고서 재시도와 노출

- 사용자·주차 UNIQUE. 성공 결과 재생성 금지. 요청 소유권은 JWT principal 기준이다.
- 자동 시도는 누적 1~3회, 수동 요청은 4~5회 범위에서 각 1회. FAILED·retryable·60초 cooldown·최근 완료 4주를 모두 만족해야 한다. 시도 수를 초기화하지 않는다.
- 비공개 입력은 SOURCE_UNAVAILABLE로 종료하며 스냅샷을 조용히 바꾸지 않는다. 성공 이후 근거 공개 중단은 해당 연결 전체를 숨긴다.
- 요청 시 입력 최대 200건/1MiB. 전체 입력인 것처럼 부분 절삭하지 않는다.
- API/worker/배포·검증의 정확한 계약은 [진단보고서 설계](../design/diagnostic-report-design.html)를 따른다.
