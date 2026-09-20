# CHECK 검증 코드 이동 (2026-09-20)

- `001_schema.sql`의 CHECK 10개 제거. 검증 모드 기본값도 제거하며 모드는 코드가 명시한다. PK/FK/UNIQUE/NOT NULL 및 실행 중복 방지 인덱스는 유지한다.
- 뉴스 단위 테스트 86개, 타입 검사, 배치 빌드, lint 통과.
- 실행 상태/검증 모드의 미지원 값, 공백·비문자열 용어, 추적 배열 형식과 만료 순서의 잘못된 값을 코드가 거부함을 검증했다.
- 기존 서비스 데이터를 복사한 별도 임시 PostgreSQL DB에서 최종 DDL 두 번 적용, 파이프라인 CHECK 0개 확인.
- 해당 DB에서 discovery/collection/generation/validation/preparation 스모크 5개 모두 통과. 새 용어의 빈 설명을 `INVALID_NEWS_TERM`으로 거부하고, 용어 삽입과 완료 상태를 함께 롤백함을 확인했다.
- 기존 로컬 DB CHECK 삭제는 자동 승인 검토 거부로 실행하지 않았다. 기존 DB는 유지하고 임시 DB만 검증 후 삭제했다.
- 운영 DB 변경 및 유료 AI 호출 없음. 새 DDL을 재적용해도 이미 설치된 CHECK가 자동 삭제되지는 않는다.
