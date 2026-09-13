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
| `npm run contracts:all`                                        | SDK·e2e·OpenAPI 생성                           |
| `npm run contracts:check`                                      | 계약 재생성, 계약 테스트, 생성 TypeScript 검사 |
| `npm run typecheck:generated`                                  | 생성 TypeScript만 검사                         |

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

## 구조

```text
apps/
  api/src/
    common/                 HTTP 예외·필터·middleware
    health/                 프로세스 확인 endpoint
    issue/                  issue HTTP feature와 type
    pipeline/               실행 접수·상태·중단 확인·수동 재시도 API
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
  article/                  article domain과 repository 위치
  pipeline/                 실행 상태·상한·검증·repository port/adapter
  common/                   entity·exception·id·database·logging·transaction
  core.module.ts            공통 adapter 조립
  index.ts                  public export
```

core는 feature별로 domain과 repository를 나누고, `common`에는 여러 feature가 공유하는 기술
경계를 둡니다. import alias는 `@newtine/api/*`, `@newtine/batch/*`, `@newtine/core/*`를
사용합니다.

파이프라인 스키마는 [기본 SQL migration](libs/core/src/common/database/migration/202609130001_pipeline.sql)과
[embedding task migration](libs/core/src/common/database/migration/202609130002_pipeline_embedding_tasks.sql)을
순서대로 검토·적용한 뒤 사용합니다. 애플리케이션은 schema 자동 동기화를 수행하지 않습니다.

## 문서

[문서 안내](docs/README.md)에서 목적별 분류와 각 영역의 진입 문서를 확인하세요.

| 영역                                           | 내용                                      |
| ---------------------------------------------- | ----------------------------------------- |
| [구현 설계](docs/design/README.md)             | 모듈·데이터·API·실행 흐름을 구현하는 방법 |
| [구현 컨벤션](docs/conventions/README.md)      | 기능 전반에 반복 적용하는 작성 규칙       |
| [의사결정 기록](docs/decisions/README.md)      | 선택의 근거와 확정·미확정 상태            |
| [정책과 계약](docs/policies/README.md)         | 요구사항과 외부 데이터·API 계약           |
| [보안 리뷰](docs/reviews/security.review.html) | 확인된 보안 항목과 잔여 운영 과제         |
