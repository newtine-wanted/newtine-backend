# 공용 러너·모델 설정·DDL 검증 (2026-09-20)

- `npm run typecheck`, `npm run build:batch`, `npm run lint`: 통과.
- 뉴스 단위 테스트: 5개 스위트, 81개 통과. 기본값·환경변수 모델 선택 및 네 모델 어댑터의 요청/사용량 모델 일치 확인.
- `npm run test:news-runner`: 6개 통과. 단계 연결, 실패 지점 재개, 완료 결과 재사용, 단일 단계, 미등록 모델 비용, 잘못된 인수, 중복 실행 잠금, 소스 ID 불일치 확인.
- 러너 `--help`: DB DDL 준비 및 실행 방법 표시 확인.
- 영속 로컬 PostgreSQL과 같은 기본 스키마를 복제한 임시 DB에 DDL/용어 초기화 SQL 각각 두 번 적용: 통과. 임시 검증 DB는 검증 후 삭제.
- 기존 영속 로컬 DB에도 각각 두 번 적용: 통과. 실행 기록 4/3/1/0개와 공개 이슈 105개 보존. 뉴스 테이블 6개 및 AI/RULES_ONLY/TONE 제약 확인.
- `news-discovery-smoke.mjs`, `news-collection-smoke.mjs`, `news-generation-smoke.mjs`, `news-validation-smoke.mjs`: 모두 통과. 파이프라인 migration 없이 DDL로 준비된 DB에서 재개·동시성·중복 실행 방지·규칙 검증·실패 처리를 확인.
- 공용 러너로 `--from 3 --to 3 --source 01a0bc9b-1a75-7428-bb37-3c7aeb9d89c3` 실행: 기존 생성 실행 `01a0bca7-f50e-7070-9960-024ecd7b0a70`의 40건 재사용. manifest 및 결과·비용 보고서 저장 확인.
- 추가 유료 호출 없음. 재사용된 기존 실행의 기록은 120회, 입력 854,974 / 출력 47,874 토큰, 추정 $0.842667 USD이며 이번 검증 추가 비용이 아니다.

초기 검사에서 테스트 fixture 타입 오류와 Node 테스트를 Jest가 함께 탐색하는 문제가 발견되어 수정했다. Node 전용 파일은 `.check.mjs`로 분리하고 전용 npm 명령으로 실행한다. 수정 후 위 검사를 통과했다.

운영 DB 적용·스케줄러 등록은 수행하지 않았다. `.env.example`은 origin/main과 일치한다.
