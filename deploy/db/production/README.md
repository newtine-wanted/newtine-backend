# Production DB 수동 적용

이 디렉터리의 SQL은 **운영 담당자가 빈 production PostgreSQL에 직접 검토·실행하는 산출물**이다.
애플리케이션 startup, Docker Compose, `npm run db:migrate`에서 자동 실행하지 않는다.

## 사전 조건

- 대상이 정말 빈 application database인지 확인한다.
- 백업·복구 절차와 대상 DB 이름을 확인한다.
- PostgreSQL에서 `pgvector` extension을 사용할 수 있어야 한다.
- 검증은 PostgreSQL 18에서 수행했으므로, 운영 PostgreSQL major가 다르면 사전 호환성 확인을 한다.
- 이 SQL은 현재 저장소의 schema 기준선이며, 기존 데이터가 있는 DB에 적용하는 delta migration이 아니다.

## 실행 순서

```sh
psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/db/production/001_schema.sql
psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/db/production/002_seed.sql
psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/db/production/003_verify.sql
```

`003_verify.sql`이 실패하면 API를 배포하지 말고, 실패한 SQL과 DB 상태를 확인한다.

## Seed 범위

자동 seed는 저장소가 canonical source를 소유하는 `issue_categories` 10개와 `regions` 17개뿐이다.
entity master, publisher, article, user, admin 계정은 운영 데이터 적재 절차로 별도 입력한다.
