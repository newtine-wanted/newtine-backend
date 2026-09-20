# NEWTINE Backend

정치 이슈를 읽고 관련 맥락을 탐색할 수 있도록 돕는 서비스의 백엔드입니다.

API, batch worker, 공통 domain·repository, PostgreSQL migration을 하나의 TypeScript 모노레포에서 관리합니다.

| 구성 요소     | 역할                                                            | 시작점                   |
| ------------- | --------------------------------------------------------------- | ------------------------ |
| API           | 인증, 피드, 이슈, 온보딩, 메타데이터, 파이프라인 HTTP API       | `apps/api/src/main.ts`   |
| Batch         | DB 점검, 콘텐츠 파이프라인, 임베딩 보완, 진단보고서 worker      | `apps/batch/src/main.ts` |
| Core          | domain, repository adapter, migration, 공통 logging·transaction | `libs/core/src/`         |
| Local runtime | PostgreSQL, migration, API, 선택적 worker 실행                  | `compose.yaml`           |

## 기술 스택

| 영역           | 기술                                         | 역할                                                |
| -------------- | -------------------------------------------- | --------------------------------------------------- |
| Runtime        | Node.js 24 · TypeScript 6 · ESM/NodeNext     | API·batch 실행과 타입 안전한 모노레포               |
| API            | NestJS 12 · Nestia 13 · Typia 14             | HTTP 모듈, API 계약 생성, 런타임 입력 검증          |
| Data           | PostgreSQL · pgvector · MikroORM 7           | 영속 데이터, vector 검색 기반, migration·repository |
| Authentication | Argon2id · jose                              | password hashing, HS256 JWT, refresh session        |
| Worker / AI    | NAVER API HUB · OpenAI API                   | 뉴스 검색, 콘텐츠 파이프라인, 진단보고서 생성       |
| Observability  | Pino · nestjs-pino                           | 구조화 로그와 HTTP 요청 관측                        |
| Quality        | Jest 30 · ESLint · Prettier · GitHub Actions | 테스트, 정적 검사, CI quality gate                  |
| Local runtime  | Docker · Docker Compose                      | PostgreSQL·migration·API·worker 재현 환경           |

## 어디서 시작할까?

| 목적                           | 이동                                              |
| ------------------------------ | ------------------------------------------------- |
| 처음 실행                      | [Quick start](#quick-start)                       |
| Docker 서비스와 DB 흐름        | [Docker Compose](#docker-compose)                 |
| 환경변수·secret·Cloud Run 설정 | [Configuration](#configuration)                   |
| endpoint와 응답 계약           | [API](#api)                                       |
| worker 실행·운영 주의사항      | [Workers and operations](#workers-and-operations) |
| 장애 원인 찾기                 | [Troubleshooting](#troubleshooting)               |
| 상세 설계·정책 문서            | [Documentation](#documentation)                   |

## Quick start

### 사전 조건

- Node.js 24 계열과 npm
- 로컬 전체 실행에는 Docker Engine과 Docker Compose plugin
- 외부 API worker에는 provider 자격증명

### 권장 경로: Docker Compose

```bash
cp -n .env.example .env
docker compose up -d --build --wait db migrate api
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

정상 응답:

```json
{ "status": "ok" }
```

`/api/health`는 DB query를 실행하지 않는 process liveness 확인입니다. DB readiness는 Compose
healthcheck가, 실제 DB 연결은 `databaseCheck` 작업이 확인합니다.

### API는 호스트에서, DB는 Compose에서 실행

`databaseCheck`는 연결 확인에 성공하면 0, 작업명 오류나 연결 실패가 발생하면 1로 종료합니다.
호스트에서 직접 실행하는 초기 골격은 스키마를 자동으로 생성하거나 수정하지 않습니다. Docker
Compose는 local-only disposable base-schema fixture와 one-shot migration service를 사용해 fresh
volume의 재현 가능한 인증 검증 환경을 구성합니다.

운영 DB를 배포하기 전에 PostgreSQL 드라이버의 실제 TLS 연결과 `select 1`을 확인하려면 배포 환경의
환경변수를 주입한 상태에서 다음 명령을 실행합니다. 이 명령은 migration을 실행하지 않고,
`NODE_ENV=staging|production`, `DB_SSL_MODE=verify-full`, 읽을 수 있는 `DB_SSL_CA_PATH`를 먼저
검증한 뒤 CA 검증이 포함된 실제 DB 연결을 한 번 수행합니다.

```bash
NODE_ENV=production npm run db:tls:preflight
```

스테이징 DB가 없는 현재 로컬 환경에서는 이 검증을 실행할 대상이 없으므로, 배포 파이프라인 또는
운영 DB 접근이 가능한 일회성 작업에서 수행해야 합니다.

파이프라인 워커는 별도 장기 실행 프로세스로 시작합니다. 운영자가 이전 프로세스 종료를 확인한
뒤 API로 접수한 실행을 처리합니다. 로컬에서 한 번만 확인하려면
`PIPELINE_WORKER_ONCE=1 npm run start:batch -- pipelineWorker`를 사용합니다.
공개 후 임베딩 누락이 있으면 이전 워커 종료를 확인한 뒤
`npm run start:batch -- pipelineEmbeddingRepair`를 수동으로 실행합니다. 이 명령은 대기 작업
최대 100건을 처리하고, 실패 작업은 다음 수동 실행에서 다시 시도합니다.
이전 repair 프로세스가 비정상 종료된 경우에는 해당 프로세스의 `processExecutionId`가 실제로
종료된 것을 확인한 뒤 `PIPELINE_EMBEDDING_REPAIR_RECLAIM_OWNER=<dead-processExecutionId>`를
지정해 RUNNING claim을 PENDING으로 되돌립니다. 시간 경과만으로 작업을 탈취하지 않습니다.
보완 호출은 task에 기록한 모델을 명시해 수행하므로 YAML에서 새 모델을 선택해도 기존 pending
작업의 입력·모델 계약이 섞이지 않습니다.

```bash
cp -n .env.example .env
npm ci
npm run build
docker compose up -d --wait db migrate
NODE_ENV=development DB_HOST=127.0.0.1 node --env-file=.env dist/apps/api/src/main.js
```

호스트 Node 프로세스에서는 Compose service name인 `db` 대신 publish된 `127.0.0.1`을 사용합니다.

```bash
NODE_ENV=development DB_HOST=127.0.0.1 node --env-file=.env dist/apps/batch/src/main.js databaseCheck
```

실행 위치별 핵심 환경변수는 다음과 같습니다.

| 실행 위치            | `API_HOST`       | `API_PORT`   | `DB_HOST`   | `DB_PORT` |
| -------------------- | ---------------- | ------------ | ----------- | --------- |
| Compose API·batch    | API는 `0.0.0.0`  | API는 `3000` | `db`        | `5432`    |
| 호스트 Node 프로세스 | 기본 `127.0.0.1` | `3000`       | `127.0.0.1` | `5432`    |

Compose에서 `.env`는 interpolation 입력으로만 사용됩니다. `DB_NAME`, `DB_USER`, `DB_PASSWORD`와
선택적인 `LOG_LEVEL`, `HTTP_SLOW_THRESHOLD_MS`, `RATE_LIMIT_*`는 각 서비스의 `environment`에 명시적으로
전달되며 `.env` 파일 자체는 image에 복사되지 않습니다. API·batch·report-worker 컨테이너는 `NODE_ENV=development`와
`LOG_FORMAT=json`을 사용해 local-only 평문 DB와 production dependency-only runtime을 함께 지원하고,
`AUTH_COOKIE_SECURE`는 `true`로 고정합니다. 따라서 Docker API는 stdout JSON을 사용하고,
호스트 Node 실행은 `node --env-file=.env ...`로 개발 설정을 사용할 수 있습니다. `API_PORT`와
`DB_PORT`는 host에 publish할 포트를 정하고, 컨테이너 내부 API·PostgreSQL 포트는 각각
`3000`·`5432`로 고정됩니다. rate limit 상태는 Cloud Run 인스턴스별 API 프로세스 메모리에만
있으므로, 인스턴스별 best-effort quota입니다. 수평 확장 시 유효 허용량이 인스턴스 수만큼
늘어날 수 있고, 재시작·scale-to-zero·revision 교체 시 quota가 초기화됩니다.
호스트 Node 실행에서는 애플리케이션이 `.env`를 자동으로 읽지 않으므로 셸 환경변수나 Node
`--env-file` 등으로 직접 주입해야 합니다.

### 종료와 데이터 초기화

일반 종료는 named volume `postgres-data`를 보존합니다.

```bash
docker compose down
# 로컬 DB까지 삭제하고 다시 초기화할 때만 실행
docker compose down -v
```

`down -v`는 되돌릴 수 없는 로컬 데이터 삭제입니다.

## Docker Compose

| 서비스          | 실행 방식         | 역할                                           |
| --------------- | ----------------- | ---------------------------------------------- |
| `db`            | 기본              | `pgvector/pgvector:pg18` PostgreSQL            |
| `migrate`       | 기본              | local base fixture 위에 migration을 한 번 실행 |
| `api`           | 기본              | production runtime API                         |
| `batch`         | `tools` profile   | `databaseCheck` 같은 일회성 작업               |
| `report-worker` | `reports` profile | 진단보고서 worker                              |

```bash
docker compose up --build
docker compose --profile tools run --rm --build batch
docker compose --profile reports up -d api report-worker
docker compose config --quiet
docker build --check .
```

| 실행 위치   | API 수신 주소    | API 포트                 | DB host               |
| ----------- | ---------------- | ------------------------ | --------------------- |
| Compose API | `0.0.0.0`        | `3000`                   | `db`                  |
| 호스트 Node | `127.0.0.1` 기본 | `3000`                   | `127.0.0.1`           |
| Cloud Run   | `0.0.0.0` 기본   | 플랫폼이 주입하는 `PORT` | 배포 환경에 맞게 지정 |

Cloud Run은 `PORT`를 주입하므로 API는 `PORT` → `API_PORT` → `3000` 순서로 포트를 해석하고,
컨테이너는 `0.0.0.0`에서 수신해야 합니다. [Cloud Run container runtime contract](https://docs.cloud.google.com/run/docs/container-contract)

## Configuration

`.env`는 자동으로 읽지 않습니다. 셸 환경변수로 주입하거나 Node.js의 `--env-file` 옵션을
사용합니다. 전체 목록은 [.env.example](.env.example)을 참고하세요.

| 변수                                      | 개발·테스트 기본값        | 운영·staging                                                              |
| ----------------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `NODE_ENV`                                | `development` 또는 `test` | 명시 권장                                                                 |
| `PORT`                                    | 없음                      | Cloud Run이 주입하는 수신 포트                                            |
| `API_HOST`                                | `127.0.0.1`               | 환경에 맞게 지정                                                          |
| `API_PORT`                                | `3000`                    | 환경에 맞게 지정                                                          |
| `DB_HOST`                                 | `127.0.0.1`               | 필수                                                                      |
| `DB_PORT`                                 | `5432`                    | 필수, 1~65535 정수                                                        |
| `DB_NAME`                                 | `newtine`                 | 필수                                                                      |
| `DB_USER`                                 | `postgres`                | 필수                                                                      |
| `DB_PASSWORD`                             | `postgres`                | 필수                                                                      |
| `DB_SSL_MODE`                             | `disable`                 | `verify-full` 필수                                                        |
| `DB_SSL_CA_PATH`                          | 없음                      | `verify-full` 인증서 파일 경로 필수                                       |
| `LOG_LEVEL`                               | `debug`                   | 기본 `info`                                                               |
| `HTTP_SLOW_THRESHOLD_MS`                  | `1000`                    | 필요에 따라 지정                                                          |
| `RATE_LIMIT_WINDOW_MS`                    | `60000`                   | 공통 quota window(ms)                                                     |
| `RATE_LIMIT_MAX_REQUESTS`                 | `120`                     | IP별 공통 window quota                                                    |
| `RATE_LIMIT_AUTH_MAX_REQUESTS`            | `10`                      | signup/login/logout IP quota                                              |
| `RATE_LIMIT_AUTH_ACCOUNT_MAX_REQUESTS`    | `5`                       | canonical email account quota                                             |
| `RATE_LIMIT_REFRESH_MAX_REQUESTS`         | `20`                      | refresh IP quota                                                          |
| `RATE_LIMIT_FEED_MAX_REQUESTS`            | `30`                      | feed IP quota                                                             |
| `RATE_LIMIT_SEARCH_MAX_REQUESTS`          | `60`                      | issue search IP quota                                                     |
| `RATE_LIMIT_MAX_KEYS`                     | `10000`                   | process-local bucket 상한                                                 |
| `RATE_LIMIT_IDLE_TTL_MS`                  | `120000`                  | idle bucket 정리(ms)                                                      |
| `RATE_LIMIT_TRUST_PROXY_HOPS`             | `0`                       | Express trust proxy hop 수; staging 검증 후 지정                          |
| `NAVER_CLIENT_ID`                         | 없음                      | 파이프라인 실행 시 필수                                                   |
| `NAVER_CLIENT_SECRET`                     | 없음                      | 파이프라인 실행 시 필수                                                   |
| `OPENAI_API_KEY`                          | 없음                      | 파이프라인 실행 시 필수                                                   |
| `PIPELINE_AI_CONFIG_PATH`                 | `config/pipeline-ai.yml`  | batch 시작 시 읽는 단계별 모델·prompt 설정                                |
| `PIPELINE_AI_MODEL`                       | 빈 값                     | pipeline text stage 모델 override; 빈 값이면 stage YAML 후 기본 모델 사용 |
| `REPORT_AI_MODEL`                         | 빈 값                     | report worker 모델 override; 빈 값이면 `gpt-5.4-mini-2026-03-17` 사용     |
| `PIPELINE_WORKER_POLL_MS`                 | `1000`                    | 워커 polling 간격(ms)                                                     |
| `PIPELINE_WORKER_ONCE`                    | `0`                       | `1`이면 run 1건만 처리                                                    |
| `PIPELINE_EMBEDDING_REPAIR_RECLAIM_OWNER` | 없음                      | 종료 확인된 repair processExecutionId만 지정                              |
| `JWT_SECRET`                              | development/test fallback | 운영 필수, 32 UTF-8 bytes 이상                                            |
| `JWT_ISSUER`                              | `newtine-api`             | 필요에 따라 고정                                                          |
| `JWT_AUDIENCE`                            | `newtine-client`          | 필요에 따라 고정                                                          |
| `AUTH_COOKIE_SECURE`                      | development/test `false`  | production `true` 필수                                                    |
| `AUTH_ALLOWED_ORIGINS`                    | 빈 값(동일 origin)        | 허용할 절대 origin 목록                                                   |
| `INTEREST_ANALYSIS_WINDOW_DAYS`           | `7`                       | 마이페이지 관심 분석 rolling 기간(일), 1~365                              |
| `INTEREST_ANALYSIS_MINIMUM_SAMPLE_SIZE`   | `10`                      | 저표본 경고 임계값, 1~100000                                              |

DB 기본값은 `NODE_ENV=development` 또는 `test`일 때만 적용됩니다. 비밀값은 `.env.example`이나
Git에 실제 값을 기록하지 마세요. Rate limit 상태는 DB나 Redis와 공유하지 않으며, 인스턴스 재시작·
scale-out·scale-to-zero·revision 교체 시 보존되지 않습니다.

Pipeline 모델은 `PIPELINE_AI_MODEL` → stage YAML → 코드 fallback 순서로 결정합니다. YAML이나 env를
바꾸면 worker를 재시작해야 적용됩니다. 뉴스 검색에는 [NAVER API HUB 뉴스 검색](https://api.ncloud-docs.com/docs/naver-api-hub-search-news)의
자격증명만 사용하며 구 네이버 개발자센터 키로 fallback하지 않습니다.

### 뉴스 검색 자격증명

`.env.example`을 참고해 `NAVER_CLIENT_ID`와 `NAVER_CLIENT_SECRET`에 NAVER API HUB에서 발급한
Client ID와 Client Secret을 직접 입력합니다. 구 네이버 개발자센터 키로 자동 fallback하지 않습니다.
검색은 [NAVER API HUB 뉴스 검색](https://api.ncloud-docs.com/docs/naver-api-hub-search-news)을
사용하며, 자격증명이 없거나 비어 있으면 외부 요청 전에 실패합니다.

## Commands

| 명령                                   | 용도                                    |
| -------------------------------------- | --------------------------------------- |
| `npm ci`                               | lockfile 기준 의존성 설치               |
| `npm run build`                        | API와 batch 빌드                        |
| `npm run build:api`                    | API만 빌드                              |
| `npm run start:api`                    | 빌드된 API 실행                         |
| `npm run start:batch -- databaseCheck` | 빌드된 batch의 DB 확인                  |
| `npm run db:migrate`                   | base schema preflight 후 migration 적용 |
| `npm run format:check`                 | Prettier 검사                           |
| `npm run lint`                         | ESLint 검사                             |
| `npm run typecheck`                    | TypeScript 검사                         |
| `npm test`                             | unit + integration 테스트               |
| `npm run test:smoke`                   | 빌드된 API HTTP smoke                   |
| `npm run contracts:all`                | SDK·e2e·OpenAPI 생성                    |
| `npm run contracts:check`              | 계약 재생성·테스트·generated typecheck  |

API 계약을 바꾸면 `npm run contracts:check`를 실행하고 generated diff를 함께 검토합니다.

## API

모든 API 경로에는 `/api` 전역 prefix가 있습니다. 전체 목록은 generated/openapi.json과
`npm run contracts:all` 결과를 기준으로 합니다.

| 영역        | 주요 경로                                                                        | 인증                    |
| ----------- | -------------------------------------------------------------------------------- | ----------------------- |
| Health      | `GET /api/health`                                                                | 없음                    |
| Auth        | `/api/auth/signup`, `/login`, `/refresh`, `/logout`, `/withdraw`                 | endpoint별 상이         |
| Content     | `GET /api/feed`, `POST /api/issues/search`, `GET /api/issues/:issueId`           | 일부 선택/필수          |
| Interaction | `/api/issues/:issueId/interactions`, `/detail-views/*`                           | Bearer JWT              |
| Metadata    | `/api/metadata/categories`, `/age-groups`, `/regions`, `/political-actors`       | 없음                    |
| Onboarding  | `/api/me/onboarding`, `/complete`, `/skip`                                       | Bearer JWT              |
| Interest    | `/api/me/interest-analysis`, `/liked-issues`                                     | Bearer JWT              |
| Pipeline    | `POST /api/pipeline/runs`, `GET /api/pipeline/runs/:runId`, `retry`, `interrupt` | Bearer JWT + admin 정책 |
| Reports     | `/api/me/reports` 및 `/:reportId`                                                | Bearer JWT              |

실패 응답은 `application/problem+json`이며 다음 네 필드만 사용합니다.

```json
{
  "title": "Bad Request",
  "status": 400,
  "detail": "요청 값이 올바르지 않습니다.",
  "code": "INVALID_ARGUMENT"
}
```

`signup`과 `login`은 access JWT와 `newtine_refresh` HttpOnly cookie를 설정합니다. `refresh`는
cookie를 회전하고 `logout`은 현재 refresh session을 revoke합니다. 브라우저 cookie 세션을 만드는
signup/login과 세션을 변경하는 refresh/logout/withdraw에는 `AUTH_ALLOWED_ORIGINS`와 일치하는
`Origin` 헤더가 필요하며, 누락되거나 일치하지 않으면 `403`으로 거부하고 cookie 부작용을 만들지
않습니다. 현재 릴리스는 웹 브라우저 흐름을 기준으로 하며, signup은 모든 계정을 `USER`로 만듭니다.
자세한 인증·인가 정책은 [인증·인가 설계](docs/design/authentication-authorization-design.html)를 참고하세요.

사용자 입력과 외부 시스템 입력은 controller 경계에서 Typia로 런타임 검증하며, API 계약 변경 시
generated SDK·e2e·OpenAPI 산출물을 함께 갱신합니다.

Pipeline은 `POST /api/pipeline/runs`로 `Idempotency-Key`가 필요한 비동기 접수를 받고,
`GET /api/pipeline/runs/:runId`로 상태를 조회합니다. `interrupt`는 `expectedAttempt`와
`executionId`로 중단을 확인하고, `retry`는 실패 작업을 재시도합니다. `CONTENT` 재시도는
discovery를 반복하지 않고 선택한 실패 job의 seed URL에서 본문을 다시 확보합니다.

진단보고서는 사용자별·주차별 하나만 저장하며 최근 완료 4주·60초 cooldown·총 5시도 제한을 적용합니다.
`GET /api/me/reports`, `POST /api/me/reports`, `GET /api/me/reports/:reportId`,
`POST /api/me/reports/:reportId/retry`를 제공합니다.

## Workers and operations

### Pipeline worker

```bash
PIPELINE_WORKER_ONCE=1 npm run start:batch -- pipelineWorker
npm run start:batch -- pipelineEmbeddingRepair
```

repair worker가 비정상 종료된 경우에는 실제 종료를 확인한 뒤에만 다음을 지정합니다.

```bash
PIPELINE_EMBEDDING_REPAIR_RECLAIM_OWNER=<dead-processExecutionId> \
  npm run start:batch -- pipelineEmbeddingRepair
```

시간 경과만으로 RUNNING 작업을 탈취하지 않습니다. 보완 호출은 task에 기록된 모델을 사용합니다.

### Diagnostic report worker

```bash
npm run build
npm run db:migrate
npm run start:batch -- reportWorker

# Compose
docker compose --profile reports up -d api report-worker
```

`OPENAI_API_KEY`는 필수이며 `REPORT_AI_MODEL`은 선택입니다. 기본 제한은 동시 1건/프로세스,
polling 1초, provider timeout 60초, lease 180초, heartbeat 30초, 전체 실행 5분입니다.
자동 시도는 3회, 수동 재시도를 포함한 총 5회까지입니다. 입력·보고서·prompt 원문은 로그에 남기지
않으며 주간 입력은 200건·1MiB 상한을 넘을 수 없습니다.

## Architecture and data

```text
apps/
  api/src/       HTTP controllers, services, guards, middleware
  batch/src/     one-shot jobs, pipeline worker, report worker
libs/core/src/   domain, repository adapters, migration, shared infrastructure
```

- API·batch는 `libs/core`의 domain과 repository port/adapter를 공유합니다.
- import alias는 `@newtine/api/*`, `@newtine/batch/*`, `@newtine/core/*`를 사용합니다.
- API 계약·runtime input validation에는 Nestia와 Typia를 사용합니다.
- 데이터 접근에는 MikroORM과 PostgreSQL을 사용합니다.
- 애플리케이션은 schema 자동 동기화를 수행하지 않습니다.

`npm run db:migrate`는 외부 base schema preflight 후 온보딩·category code·pipeline·authentication·interest
migration을 적용하고 application-owned interaction schema를 검증합니다. `users`, `entities`,
`issue_categories`, `user_category_preferences`, `user_entity_preferences`는 저장소 밖의 선행 migration이
소유하고, `user_interaction_events`는 interest migration이 소유합니다. 불완전한 기존 schema는 자동
보정하지 않고 실패합니다. migration과 사후 schema 검증은 하나의 transaction으로 처리되며,
pipeline·authentication migration은 데이터 손실 방지를 위해 `down`을 지원하지 않습니다.

## Documentation

README는 첫 실행과 운영 진입점만 다룹니다. 세부 설계와 정책은 다음 문서로 분리되어 있습니다.

| 문서                                           | 용도                              |
| ---------------------------------------------- | --------------------------------- |
| [문서 안내](docs/README.md)                    | 목적별 문서 분류와 읽는 순서      |
| [구현 설계](docs/design/README.md)             | 모듈·데이터·API·실행 흐름         |
| [구현 컨벤션](docs/conventions/README.md)      | 반복 적용하는 코드·문서 규칙      |
| [의사결정 기록](docs/decisions/README.md)      | 선택 근거와 확정·미확정 상태      |
| [정책과 계약](docs/policies/README.md)         | 요구사항과 외부 데이터·API 계약   |
| [보안 리뷰](docs/reviews/security.review.html) | 확인된 보안 항목과 잔여 운영 과제 |
| [ERD](docs/design/erd.md)                      | 테이블·관계·키·제약               |

## Troubleshooting

| 증상                              | 먼저 확인할 것                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`가 404               | 전역 prefix를 포함한 `/api/health`를 사용합니다.                                                                              |
| API가 DB 초기화 단계에서 종료     | production에서는 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`가 모두 필요합니다.                                 |
| Cloud Run이 포트를 찾지 못함      | `PORT`와 `API_HOST=0.0.0.0`를 확인합니다. [Cloud Run troubleshooting](https://docs.cloud.google.com/run/docs/troubleshooting) |
| worker가 provider 호출 전에 실패  | provider credentials와 worker 전용 env를 확인합니다.                                                                          |
| 계약 파일이 달라짐                | `npm run contracts:check` 실행 후 generated diff를 검토합니다.                                                                |
| 로컬 DB를 완전히 다시 만들고 싶음 | disposable local DB인지 확인한 뒤 `docker compose down -v`를 사용합니다.                                                      |

## Contributing

변경 전후에 가능한 범위의 quality gate를 실행하세요.

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

API 계약을 바꾸는 변경은 다음도 실행합니다.

```bash
npm run contracts:check
node scripts/check-generated.mjs
```

Pull request CI는 formatting, lint, typecheck, unit/integration test, build, 계약 검사와 generated
artifact 안정성 검사를 수행합니다. 변경 설명에는 범위, 실행한 검증 명령, 남은 운영 위험을 함께 적어 주세요.
