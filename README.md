# NEWTINE Backend

관심 있는 정치 이슈를 읽고 관련 맥락을 탐색할 수 있도록 돕는 서비스의 백엔드입니다.

NestJS 모노레포에서 API와 batch 앱이 `libs/core`의 공통 경계를 사용합니다. API 계약과 런타임
입력 검증에는 Nestia와 Typia를 사용하고, 데이터 접근에는 MikroORM과 PostgreSQL을 사용합니다.
기존 도메인은 초기 골격으로 유지되며, 이번 이슈·기사 콘텐츠 파이프라인은 API·worker·repository·명시적
migration을 포함한 vertical slice로 구현되어 있습니다.

## 기술 스택

| 영역                 | 선택                                 |
| -------------------- | ------------------------------------ |
| 프레임워크           | NestJS 12                            |
| 언어·모듈            | TypeScript 6 · ESM/NodeNext          |
| ORM·DB               | MikroORM 7 · PostgreSQL              |
| 인증·인가             | Argon2id · jose HS256 JWT · USER/ADMIN |
| API 계약·런타임 검증 | Nestia 13 · Typia 14                 |
| 로깅                 | Pino · nestjs-pino                   |
| 빌드·개발 실행       | `ttsc` · `ttsx`                      |
| 테스트               | Jest 30 · contract test · smoke test |

## 빠른 시작

Node.js 24 계열과 npm을 사용합니다.

```bash
npm install
npm run build
NODE_ENV=development npm run start:api
```

API가 실행되면 [http://127.0.0.1:3000/health](http://127.0.0.1:3000/health)에서 다음 응답을
확인할 수 있습니다.

```json
{ "status": "ok" }
```

DB 연결 작업은 작업명을 명시해 실행합니다.

```bash
NODE_ENV=development npm run start:batch -- databaseCheck
```

`databaseCheck`는 연결 확인에 성공하면 0, 작업명 오류나 연결 실패가 발생하면 1로 종료합니다.
호스트에서 직접 실행하는 초기 골격은 스키마를 자동으로 생성하거나 수정하지 않습니다. Docker
Compose는 local-only disposable base-schema fixture와 one-shot migration service를 사용해 fresh
volume의 재현 가능한 인증 검증 환경을 구성합니다.

파이프라인 워커는 별도 장기 실행 프로세스로 시작합니다. 운영자가 이전 프로세스 종료를 확인한
뒤 API로 접수한 실행을 처리합니다. 로컬에서 한 번만 확인하려면
`PIPELINE_WORKER_ONCE=1 npm run start:batch -- pipelineWorker`를 사용합니다.
공개 후 임베딩 누락이 있으면 이전 워커 종료를 확인한 뒤
`npm run start:batch -- pipelineEmbeddingRepair`를 수동으로 실행합니다. 이 명령은 대기 작업
최대 100건을 처리하고, 실패 작업은 다음 수동 실행에서 다시 시도합니다.
이전 repair 프로세스가 비정상 종료된 경우에는 해당 프로세스의 `processExecutionId`가 실제로
종료된 것을 확인한 뒤 `PIPELINE_EMBEDDING_REPAIR_RECLAIM_OWNER=<dead-processExecutionId>`를
지정해 RUNNING claim을 PENDING으로 되돌립니다. 시간 경과만으로 작업을 탈취하지 않습니다.
보완 호출은 task에 기록된 모델을 명시해 수행하므로 YAML에서 새 모델을 선택해도 기존 pending
작업의 입력·모델 계약이 섞이지 않습니다.
## Docker 로컬 실행

Docker Engine과 Compose plugin이 필요합니다. 기본 Compose 서비스는 PostgreSQL `db`, one-shot
schema migration `migrate`, API `api`이며, batch는 `tools` profile의 일회성 작업으로 기본 실행에
포함되지 않습니다.

### API와 PostgreSQL 함께 실행

먼저 local secret을 준비합니다. `.env.example`의 값은 local 검증용이며 production secret으로
재사용하지 않습니다.

```bash
cp -n .env.example .env
```

다음 명령으로 이미지를 빌드하고, 빈 DB의 local base fixture·migration을 적용한 뒤 PostgreSQL과
API를 계속 실행합니다.

```bash
docker compose up --build
```

별도 터미널에서 API liveness를 확인합니다.

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/health
```

`API_PORT`를 기본값 3000과 다르게 지정했다면 URL의 host port도 같은 값으로 바꿉니다.

응답은 `{ "status": "ok" }`이며, 이 endpoint는 DB query를 실행하지 않는 process liveness
확인입니다. DB readiness는 Compose의 `db` healthcheck(`pg_isready`)로, 실제 DB 연결은
batch `databaseCheck`로 각각 확인합니다. 백그라운드에서 readiness까지 기다리며 실행하려면 다음을
사용합니다.

```bash
docker compose up -d --build --wait db migrate api
```

### 필요할 때 batch 실행

`databaseCheck`는 실제 `select 1`을 실행하는 one-shot 작업입니다. 성공하면 0, DB 연결이나 작업이
실패하면 1을 반환하며 자동 재시작하거나 무한 재시도하지 않습니다.

```bash
docker compose --profile tools run --rm --build batch
```

실패 경로와 non-zero exit를 확인해야 할 때는 DB를 멈춘 뒤 `--no-deps`로 실행합니다. 아래 실패
batch 명령의 예상 종료 코드는 1입니다. 확인 후 DB를 health 상태까지 다시 올리고, 성공하는 batch
명령을 명시적으로 다시 실행합니다.

```bash
docker compose stop db
docker compose --profile tools run --rm --build --no-deps batch
docker compose up -d --wait db migrate
docker compose --profile tools run --rm --build batch
```

### DB만 Compose에서 실행하고 API를 호스트에서 실행

호스트 Node 프로세스는 Compose network의 service name을 해석하지 못하므로 `DB_HOST=db`가 아니라
publish된 loopback 주소를 사용합니다.

```bash
cp -n .env.example .env
npm install
npm run build
docker compose up -d --wait db migrate
NODE_ENV=development DB_HOST=127.0.0.1 node --env-file=.env dist/apps/api/src/main.js
```

호스트에서 batch를 실행할 때도 같은 DB host를 사용합니다.

```bash
NODE_ENV=development DB_HOST=127.0.0.1 node --env-file=.env dist/apps/batch/src/main.js databaseCheck
```

실행 위치별 핵심 환경변수는 다음과 같습니다.

| 실행 위치            | `API_HOST`     | `API_PORT` | `DB_HOST`    | `DB_PORT` |
| -------------------- | -------------- | ---------- | ----------- | --------- |
| Compose API·batch     | API는 `0.0.0.0` | API는 `3000` | `db`        | `5432`    |
| 호스트 Node 프로세스 | 기본 `127.0.0.1` | `3000`     | `127.0.0.1` | `5432`    |

Compose에서 `.env`는 interpolation 입력으로만 사용됩니다. `DB_NAME`, `DB_USER`, `DB_PASSWORD`와
선택적인 `LOG_LEVEL`, `HTTP_SLOW_THRESHOLD_MS`는 각 서비스의 `environment`에 명시적으로
전달되며 `.env` 파일 자체는 image에 복사되지 않습니다. `API_PORT`와 `DB_PORT`는 host에
publish할 포트를 정하고, 컨테이너 내부 API·PostgreSQL 포트는 각각 `3000`·`5432`로 고정됩니다.
호스트 Node 실행에서는 애플리케이션이 `.env`를 자동으로 읽지 않으므로 셸 환경변수나 Node
`--env-file` 등으로 직접 주입해야 합니다.

### 종료와 데이터 초기화

일반 종료는 named volume `postgres-data`를 보존합니다.

```bash
docker compose down
```

기존 로컬 DB 데이터를 모두 버리고 다시 초기화해야 할 때만 다음 명령을 명시적으로 실행합니다.
이 명령은 되돌릴 수 없는 로컬 데이터 삭제이므로 대상과 보존 필요성을 먼저 확인해야 합니다.

```bash
docker compose down -v
```

공식 PostgreSQL image는 빈 volume에서 `POSTGRES_DB`, user, password를 초기화하고, 이 Compose는
추가로 `compose/postgres-init/001-base-schema.sql`을 local-only disposable fixture로 실행합니다.
`migrate` service가 그 위에 onboarding·category code·pipeline·authentication delta migration을
적용합니다. 이 fixture와 자동 migration은 production base schema owner를 대체하지 않으며,
운영 DB에는 적용하지 않습니다. `ensureDatabase=false`와 schema sync 비활성 전제는 유지합니다.
기존 local DB 데이터를 보존한 채 schema 변경에 대응할 때는 별도의 migration 절차를 사용하고,
fixture를 다시 만들 때만 대상 volume을 명시적으로 초기화합니다.

### Docker 검증

설정과 image 구성을 먼저 확인한 뒤 DB readiness, API liveness, batch 연결을 각각 검증합니다.

```bash
docker compose config --quiet
docker build --check .
docker compose up -d --build --wait db migrate api
curl --fail --silent --show-error http://127.0.0.1:3000/health
docker compose --profile tools run --rm --build batch
docker compose down
```

`docker compose down` 뒤에는 `docker volume ls`로 `postgres-data`가 보존되는지 확인할 수 있습니다.
이 설정은 로컬 개발 재현을 위한 것이며 production deployment readiness를 의미하지 않습니다.

## 환경 변수

`.env` 파일은 자동으로 읽지 않습니다. 셸이나 실행 환경에서 주입하거나 Node.js의 env-file
옵션을 사용합니다.

```bash
node --env-file=.env dist/apps/api/src/main.js
```

| 변수                      | 개발·테스트 기본값        | 운영·staging            |
| ------------------------- | ------------------------- | ----------------------- |
| `NODE_ENV`                | `development` 또는 `test` | 명시 권장               |
| `API_HOST`                | `127.0.0.1`               | 환경에 맞게 지정        |
| `API_PORT`                | `3000`                    | 환경에 맞게 지정        |
| `DB_HOST`                 | `127.0.0.1`               | 필수                    |
| `DB_PORT`                 | `5432`                    | 필수, 1~65535 정수      |
| `DB_NAME`                 | `newtine`                 | 필수                    |
| `DB_USER`                 | `postgres`                | 필수                    |
| `DB_PASSWORD`             | `postgres`                | 필수                    |
| `LOG_LEVEL`               | `debug`                   | 기본 `info`             |
| `HTTP_SLOW_THRESHOLD_MS`  | `1000`                    | 필요에 따라 지정        |
| `NAVER_CLIENT_ID`         | 없음                      | 파이프라인 실행 시 필수 |
| `NAVER_CLIENT_SECRET`     | 없음                      | 파이프라인 실행 시 필수 |
| `OPENAI_API_KEY`          | 없음                      | 파이프라인 실행 시 필수 |
| `PIPELINE_AI_CONFIG_PATH` | `config/pipeline-ai.yml`  | batch 시작 시 읽는 단계별 모델·prompt 설정 |
| `PIPELINE_WORKER_POLL_MS` | `1000`                    | 워커 polling 간격(ms)   |
| `PIPELINE_WORKER_ONCE`     | `0`                       | `1`이면 run 1건만 처리   |
| `PIPELINE_EMBEDDING_REPAIR_RECLAIM_OWNER` | 없음 | 종료 확인된 repair processExecutionId만 지정 |
| `JWT_SECRET`             | development/test fallback | 운영 필수, 32 UTF-8 bytes 이상 |
| `JWT_ISSUER`             | `newtine-api`             | 필요에 따라 고정   |
| `JWT_AUDIENCE`           | `newtine-client`          | 필요에 따라 고정   |
| `AUTH_COOKIE_SECURE`     | development/test `false` | production `true` 필수 |
| `AUTH_ALLOWED_ORIGINS`   | 빈 값(동일 origin)        | 허용할 절대 origin 목록 |
| `INTEREST_ANALYSIS_WINDOW_DAYS` | `7` | 마이페이지 관심 분석 rolling 기간(일), 1~365 |
| `INTEREST_ANALYSIS_MINIMUM_SAMPLE_SIZE` | `10` | 저표본 경고 임계값, 1~100000 |

DB 기본값은 `NODE_ENV=development` 또는 `test`일 때만 적용됩니다. 그 외 환경에서는 DB 변수
누락·빈 값·잘못된 포트가 ORM 초기화 단계에서 실패합니다. 로컬 예시는 [.env.example](.env.example)을
참고하세요. `PIPELINE_AI_CONFIG_PATH`는 batch worker가 시작할 때 한 번 읽습니다. YAML을 변경하면
worker를 재시작해야 다음 실행부터 적용되며, API 프로세스는 이 파일을 읽지 않습니다.

## 개발 명령

| 명령                                                           | 용도                                           |
| -------------------------------------------------------------- | ---------------------------------------------- |
| `npm run build`                                                | API와 batch 빌드                               |
| `npm run start:api`                                            | 빌드된 API 실행                                |
| `npm run start:batch -- databaseCheck`                         | 빌드된 batch의 DB 확인 작업 실행               |
| `PIPELINE_WORKER_ONCE=1 npm run start:batch -- pipelineWorker` | 파이프라인 worker 1회 실행                     |
| `npm run start:batch -- pipelineEmbeddingRepair`              | 공개 후 임베딩 pending 작업 수동 보완(최대 100건) |
| `PIPELINE_EMBEDDING_REPAIR_RECLAIM_OWNER=<id> npm run start:batch -- pipelineEmbeddingRepair` | 종료 확인된 repair claim 재큐잉 후 수동 보완 |
| `npm test`                                                     | unit·integration 테스트                        |
| `npm run test:contracts`                                       | 생성 계약 테스트                               |
| `npm run test:smoke`                                           | 빌드된 API의 실제 HTTP 동작 확인               |
| `npm run test:smoke:compose`                                  | fresh Compose 인증 smoke 확인                  |
| `npm run test:smoke:compose:data`                             | disposable PostgreSQL 이슈 데이터·회원/비회원 cursor smoke |
| `npm run contracts:all`                                        | SDK·e2e·OpenAPI 생성                           |
| `npm run contracts:check`                                      | 계약 재생성, 계약 테스트, 생성 TypeScript 검사 |
| `npm run typecheck:generated`                                  | 생성 TypeScript만 검사                         |
| `npm run db:migrate`                                            | 온보딩·category·pipeline·authentication migration 적용 |

## API 계약과 입력 검증

성공 응답은 기능 데이터만 반환하고, 실패 응답은 RFC 9457 형식에 맞춘 다음 네 필드만 사용합니다.

```json
{
  "title": "Bad Request",
  "status": 400,
  "detail": "요청 값이 올바르지 않습니다.",
  "code": "INVALID_ARGUMENT"
}
```

실패 응답의 media type은 `application/problem+json`이며 `type`, `instance`, `errors`는 포함하지
않습니다. 사용자의 입력과 외부 시스템의 입력은 controller 경계에서 항상 Typia로 런타임 검증합니다.

```ts
@TypedBody<IssueSearchRequest>({
  type: 'validate',
  validate: (input) => typia.validateEquals<IssueSearchRequest>(input),
})
request: IssueSearchRequest
```

SDK·e2e·OpenAPI 산출물은 `npm run contracts:all`로 생성합니다. 생성 결과의 세부 규칙과 보정
범위는 [데이터·응답 계약](docs/policies/data-contracts.md)과 [백엔드 구현 컨벤션](docs/conventions/backend-conventions.md)을
참고하세요.

파이프라인은 `POST /pipeline/runs`(필수 `Idempotency-Key`, 본문은 `query`만)로 비동기 접수하고,
`GET /pipeline/runs/:runId`로 상태를 조회합니다. 실행량 상한은 서버 내부 정책이며 API 요청·응답에
노출하지 않습니다. 프로세스 종료를 확인한 운영자는
`POST /pipeline/runs/:runId/interrupt`에 `expectedAttempt`·`executionId`를 보내
중단 처리한 뒤 `POST /pipeline/runs/:runId/retry`로 실패 작업을 재시도합니다. `CONTENT`
재시도는 discovery를 반복하지 않고 선택한 실패 job의 seed URL에서 본문을 다시 확보합니다.

### 인증 API

`POST /auth/signup`과 `POST /auth/login`은 `{ "email": "...", "password": "..." }`를 받아
access JWT를 JSON으로 반환하고 `newtine_refresh` HttpOnly cookie를 설정합니다. `POST /auth/refresh`는
cookie를 회전하고 새 access JWT를 반환하며, `POST /auth/logout`은 현재 refresh session만 revoke하고
cookie를 삭제합니다. access JWT는 `Authorization: Bearer <token>`으로 `/me/**` 요청에 사용합니다.

signup은 모든 계정을 `USER`로 만들며, `ADMIN` role은 운영자 절차로만 부여됩니다.
자세한 인증·인가 정책과 migration 적용 조건은
[인증·인가 설계 문서](docs/design/authentication-authorization-design.html)를 참고하세요.

## 구조

```text
apps/
  api/src/
    common/                 HTTP 예외·필터·middleware
    health/                 프로세스 확인 endpoint
    issue/                  issue HTTP feature와 type
    auth/                   local credential·JWT·refresh·role guard
    pipeline/               실행 접수·상태·중단 확인·수동 재시도 API
    onboarding/             온보딩 HTTP feature와 principal seam
    main.ts
    api.module.ts
  batch/src/
    job/databaseCheck/      DB 확인 작업
    pipeline/               단일 워커·Naver/OpenAI 외부 어댑터
    runner/                 작업 선택·실행
    main.ts
    batch.module.ts
libs/core/src/
  issue/                    issue domain과 repository 경계
  onboarding/               온보딩 domain·PostgreSQL adapter·migration
  auth/                      인증 domain·session adapter·migration
  article/                  article domain과 repository 위치
  pipeline/                 실행 상태·상한·검증·repository port/adapter
  common/                   entity·exception·id·database·logging·transaction
  core.module.ts            공통 adapter 조립
  index.ts                  public export
```

core는 feature별로 domain과 repository를 나누고, `common`에는 여러 feature가 공유하는 기술
경계를 둡니다. import alias는 `@newtine/api/*`, `@newtine/batch/*`, `@newtine/core/*`를
사용합니다.

스키마는 [MikroORM migration](libs/core/src/pipeline/migrations/)으로 관리하며
`npm run db:migrate`가 외부 base schema preflight 후 온보딩·category code·pipeline·authentication migration을
등록 순서대로 한 번에 적용합니다. `users`, `entities`, `issue_categories`,
`user_category_preferences`, `user_entity_preferences`는 이 저장소 밖의 선행 migration이 소유합니다.
category master의 PK는 `issue_categories.code`이며 이슈·분류 선호도는 `category_code`로 참조합니다.
파이프라인·authentication migration은 데이터 손실을 막기 위해 `down`을 지원하지 않습니다.
애플리케이션은 schema 자동 동기화를 수행하지 않습니다.

## 문서

[문서 안내](docs/README.md)에서 목적별 분류와 각 영역의 진입 문서를 확인하세요.

| 영역                                           | 내용                                      |
| ---------------------------------------------- | ----------------------------------------- |
| [구현 설계](docs/design/README.md)             | 모듈·데이터·API·실행 흐름을 구현하는 방법 |
| [구현 컨벤션](docs/conventions/README.md)      | 기능 전반에 반복 적용하는 작성 규칙       |
| [의사결정 기록](docs/decisions/README.md)      | 선택의 근거와 확정·미확정 상태            |
| [정책과 계약](docs/policies/README.md)         | 요구사항과 외부 데이터·API 계약           |
| [보안 리뷰](docs/reviews/security.review.html) | 확인된 보안 항목과 잔여 운영 과제         |
