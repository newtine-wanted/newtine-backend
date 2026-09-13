# NEWTINE Backend

관심 있는 정치 이슈를 읽고 관련 맥락을 탐색할 수 있도록 돕는 서비스의 백엔드입니다.

NestJS 모노레포에서 API와 batch 앱이 `libs/core`의 공통 경계를 사용합니다. API 계약과 런타임
입력 검증에는 Nestia와 Typia를 사용하고, 데이터 접근에는 MikroORM과 PostgreSQL을 사용합니다.
현재 저장소는 실행 가능한 초기 골격이며, 업무 entity·repository·migration은 기능을 추가할 때
vertical slice로 함께 구현합니다.

## 기술 스택

| 영역                 | 선택                                 |
| -------------------- | ------------------------------------ |
| 프레임워크           | NestJS 12                            |
| 언어·모듈            | TypeScript 6 · ESM/NodeNext          |
| ORM·DB               | MikroORM 7 · PostgreSQL              |
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
초기 골격은 스키마를 자동으로 생성하거나 수정하지 않습니다.

## Docker 로컬 실행

Docker Engine과 Compose plugin이 필요합니다. 기본 Compose 서비스는 PostgreSQL `db`와 API
`api`이며, batch는 `tools` profile의 일회성 작업으로 기본 실행에 포함되지 않습니다.

### API와 PostgreSQL 함께 실행

다음 명령 하나로 이미지를 빌드하고 PostgreSQL과 API를 계속 실행합니다.

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
docker compose up -d --build --wait db api
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
docker compose up -d --wait db
docker compose --profile tools run --rm --build batch
```

### DB만 Compose에서 실행하고 API를 호스트에서 실행

호스트 Node 프로세스는 Compose network의 service name을 해석하지 못하므로 `DB_HOST=db`가 아니라
publish된 loopback 주소를 사용합니다.

```bash
cp -n .env.example .env
npm install
npm run build
docker compose up -d --wait db
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

공식 PostgreSQL image는 빈 volume에서 `POSTGRES_DB`, user, password만 초기화합니다. 이 Compose
환경은 application table, init SQL, schema sync, migration, seed를 생성하거나 실행하지 않으며,
`ensureDatabase=false` 전제를 유지합니다. schema 변경 대응은 별도의 migration 설계 또는 확인된
데이터 삭제 절차로 다뤄야 합니다.

### Docker 검증

설정과 image 구성을 먼저 확인한 뒤 DB readiness, API liveness, batch 연결을 각각 검증합니다.

```bash
docker compose config --quiet
docker build --check .
docker compose up -d --build --wait db api
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

| 변수                     | 개발·테스트 기본값        | 운영·staging       |
| ------------------------ | ------------------------- | ------------------ |
| `NODE_ENV`               | `development` 또는 `test` | 명시 권장          |
| `API_HOST`               | `127.0.0.1`               | 환경에 맞게 지정   |
| `API_PORT`               | `3000`                    | 환경에 맞게 지정   |
| `DB_HOST`                | `127.0.0.1`               | 필수               |
| `DB_PORT`                | `5432`                    | 필수, 1~65535 정수 |
| `DB_NAME`                | `newtine`                 | 필수               |
| `DB_USER`                | `postgres`                | 필수               |
| `DB_PASSWORD`            | `postgres`                | 필수               |
| `LOG_LEVEL`              | `debug`                   | 기본 `info`        |
| `HTTP_SLOW_THRESHOLD_MS` | `1000`                    | 필요에 따라 지정   |

DB 기본값은 `NODE_ENV=development` 또는 `test`일 때만 적용됩니다. 그 외 환경에서는 DB 변수
누락·빈 값·잘못된 포트가 ORM 초기화 단계에서 실패합니다. 로컬 예시는 [.env.example](.env.example)을
참고하세요.

## 개발 명령

| 명령                                   | 용도                                           |
| -------------------------------------- | ---------------------------------------------- |
| `npm run build`                        | API와 batch 빌드                               |
| `npm run start:api`                    | 빌드된 API 실행                                |
| `npm run start:batch -- databaseCheck` | 빌드된 batch의 DB 확인 작업 실행               |
| `npm test`                             | unit·integration 테스트                        |
| `npm run test:contracts`               | 생성 계약 테스트                               |
| `npm run test:smoke`                   | 빌드된 API의 실제 HTTP 동작 확인               |
| `npm run db:migrate`                    | 기존 base schema에 온보딩 delta migration 적용  |
| `npm run contracts:all`                | SDK·e2e·OpenAPI 생성                           |
| `npm run contracts:check`              | 계약 재생성, 계약 테스트, 생성 TypeScript 검사 |
| `npm run typecheck:generated`          | 생성 TypeScript만 검사                         |

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

## 구조

```text
apps/
  api/src/
    common/                 HTTP 예외·필터·middleware
    health/                 프로세스 확인 endpoint
    issue/                  issue HTTP feature와 type
    onboarding/             온보딩 HTTP feature와 principal seam
    main.ts
    api.module.ts
  batch/src/
    job/databaseCheck/      DB 확인 작업
    runner/                 작업 선택·실행
    main.ts
    batch.module.ts
libs/core/src/
  issue/                    issue domain과 repository 경계
  onboarding/               온보딩 domain·PostgreSQL adapter·migration
  article/                  article domain과 repository 위치
  common/                   entity·exception·id·database·logging·transaction
  core.module.ts            공통 adapter 조립
  index.ts                  public export
```

core는 feature별로 domain과 repository를 나누고, `common`에는 여러 feature가 공유하는 기술
경계를 둡니다. import alias는 `@newtine/api/*`, `@newtine/batch/*`, `@newtine/core/*`를
사용합니다.

## 문서

[문서 안내](docs/README.md)에서 목적별 분류와 각 영역의 진입 문서를 확인하세요.

| 영역                                           | 내용                                      |
| ---------------------------------------------- | ----------------------------------------- |
| [구현 설계](docs/design/README.md)             | 모듈·데이터·API·실행 흐름을 구현하는 방법 |
| [구현 컨벤션](docs/conventions/README.md)      | 기능 전반에 반복 적용하는 작성 규칙       |
| [의사결정 기록](docs/decisions/README.md)      | 선택의 근거와 확정·미확정 상태            |
| [정책과 계약](docs/policies/README.md)         | 요구사항과 외부 데이터·API 계약           |
| [보안 리뷰](docs/reviews/security.review.html) | 확인된 보안 항목과 잔여 운영 과제         |
