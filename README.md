# NEWTINE Backend

2030 사용자가 관심 있는 정치 이슈를 쉽게 읽고, 연결된 맥락과 새로운 이슈를 접할 수 있도록 돕는 서비스의 백엔드 저장소입니다.

NestJS 모노레포 기반의 초기 실행 골격이 구성되어 있습니다. API와 일회성 batch 앱이 `libs/core`의 MikroORM·transaction 경계를 공유합니다. API 계약은 Nestia·Typia로 생성하며 `ttsc`·`ttsx`가 컴파일·개발을, Jest가 테스트를 담당합니다. 신규 내부 영속 ID는 `libs/core`의 애플리케이션 UUIDv7 생성기를 사용하고 PostgreSQL `uuid`로 저장합니다. 실제 업무 entity, repository, DDL, 마이그레이션은 후속 범위입니다.

## 기술 스택

| 영역 | 선택 |
| --- | --- |
| 프레임워크 | NestJS 12 |
| 언어·모듈 | TypeScript 6 타입 API · ESM/NodeNext |
| ORM·DB | MikroORM 7 · PostgreSQL |
| API 계약·런타임 검증 | Nestia 13 · Typia 14 |
| 로깅 | Pino · nestjs-pino |
| 빌드·개발 실행 | `ttsc` · `ttsx` |
| 테스트 | Jest 30 (unit·integration·contract) · smoke script |

## 실행

Node.js 24 계열과 npm을 사용합니다. `ttsc`·`ttsx`의 TypeScript native 실행 파일은
OS·아키텍처별 optional dependency로 설치되며 빌드·개발 실행에는 TypeScript 7.0.2를 사용합니다.
`typecheck:generated`의 일반 `tsc`는 package에 고정한 TypeScript 6.0.3을 사용합니다.

```bash
npm install
npm run build
NODE_ENV=development npm run start:api
```

API는 기본적으로 `http://127.0.0.1:3000/health`에서 `{"status":"ok"}`를 반환합니다. DB 설정은 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` 환경변수로 지정합니다. batch는 작업명을 명시해 실행합니다.

```bash
NODE_ENV=development npm run start:batch -- databaseCheck
```

`databaseCheck`는 DB 연결 확인 후 성공 시 0, 잘못된 작업명·연결 실패 시 1로 종료합니다. 초기 골격은 스키마를 자동 생성하거나 수정하지 않습니다.

개발 DB 기본값은 `NODE_ENV=development` 또는 `test`일 때만 적용됩니다. 운영·staging·NODE_ENV 미설정 상태에서는 다섯 DB 환경변수를 모두 지정해야 하며, 누락·빈 값·잘못된 포트(정수 1~65535 범위 밖)는 ORM 초기화 시 실패합니다. 오류에는 설정값을 출력하지 않습니다. `.env` 파일은 자동으로 읽지 않으므로 셸/실행 환경에서 변수를 주입하거나 `node --env-file=.env dist/apps/api/src/main.js`로 실행합니다. 빌드와 계약 생성은 DB 설정 없이 실행 가능합니다.

요청 ID는 body parser보다 먼저 생성됩니다. 잘못된 JSON은 400, 기본 본문 제한(100KB)을 넘긴 요청은 413으로 응답하며 `x-request-id`와 서버 로그 ID가 일치합니다. 로그는 Pino·nestjs-pino로 stdout JSON을 사용하고, 개발 환경에서는 `pino-pretty`를 사용할 수 있습니다. 정상 HTTP 완료 로그는 자동으로 남기지 않으며, `HTTP_SLOW_THRESHOLD_MS`(기본 1000ms)를 넘긴 정상 요청만 `http.slow` warn으로 기록합니다. 도메인 예외는 `IssueException`처럼 도메인별 타입으로 구분하고, 로그에는 예외 이름·도메인·도메인 코드·API 코드·request ID와 5xx의 제한된 진단 정보를 구조화해 기록합니다. 5xx 진단은 예외 message 원문을 남기지 않고 stack 첫 줄을 제거하며, cause는 이름·stack frame만 깊이 제한으로 기록하고 알려진 비밀값 패턴을 `[REDACTED]`로 보정합니다. 5xx 본문은 일반 메시지를 반환하며 예외 response·요청 body·임의 객체 속성은 로그에 직렬화하지 않습니다. 예외 메시지 자체에 자격증명이나 요청 원문을 넣지 않아야 합니다.

사용자와 외부 시스템의 입력은 항상 입력 어댑터 경계에서 런타임 검증합니다. 현재 API는 Nestia와 Typia를 함께 사용합니다. TypeScript 타입이나 mapper만으로 검증을 대신하지 않으며, body·query·path·header 등 모든 입력 계약에 같은 원칙을 적용합니다.

```ts
@TypedBody<IssueSearchRequest>({
  type: 'validate',
  validate: (input) => typia.validateEquals<IssueSearchRequest>(input),
})
request: IssueSearchRequest
```

검증 실패는 `INVALID_ARGUMENT`으로 정규화하고 입력 원문과 검증 상세는 응답·로그에 포함하지 않습니다. 자세한 경계 규칙은 [백엔드 구현 컨벤션](docs/design/backend-conventions.md)을 따릅니다.

`LOG_LEVEL`은 `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` 중 하나이며, 기본값은 운영 `info`, 개발 `debug`입니다. 요청별 지연 분포는 로그가 아니라 별도 메트릭 작업에서 histogram으로 수집할 예정입니다.

Nestia 계약 산출물은 다음 명령으로 생성하고 검증합니다.

```bash
npm run contracts:all
npm run contracts:check
```

`contracts:all`은 `generated/api`, `generated/e2e`, `generated/openapi.json`을 생성합니다. SDK·e2e는 Nestia를 직접 실행하고 Swagger는 `scripts/openapi.mjs`가 Nestia 실행 직후 ProblemDetails 실패 응답의 media type만 `application/problem+json`으로 보정합니다. 상대 서버 URL(`/`)은 `nestia.config.ts`에서 관리합니다. 실패 본문은 `title`, `status`, `detail`, `code` 네 필드로 구성하며 `type`, `instance`, `errors`는 포함하지 않습니다. 프레임워크 4xx의 payload와 요청 URL은 `detail`에 그대로 반사하지 않고 승인된 고정 문구로 정규화합니다. `contracts:sdk`, `contracts:swagger`, `contracts:e2e`로 산출물을 개별 생성할 수도 있습니다. `contracts:check`는 공식 생성 명령을 다시 실행한 뒤 계약 테스트와 생성 TypeScript의 Bundler typecheck를 실행합니다. 생성된 OpenAPI에는 특정 호스트·포트를 넣지 않으므로 Swagger 요청은 문서를 연 현재 origin을 사용합니다.

최종 OpenAPI는 보정이 포함된 `npm run contracts:swagger` 또는 `npm run contracts:all`로 생성합니다. `nestia swagger`를 직접 실행한 결과는 보정 전 중간 산출물입니다.

빌드된 API를 독립 포트에서 확인하려면 `npm run test:smoke`를 실행합니다. smoke는 자식 API의 준비 신호를 받은 뒤 실제로 할당된 포트에 요청하고, 완료 후 자식 프로세스를 정리합니다.

생성 TypeScript만 빠르게 확인하려면 다음 명령을 사용합니다.

```bash
npm run typecheck:generated
```

단위·integration 테스트는 Jest로 실행합니다.

```bash
npm test
```

계약 산출물 검사는 같은 Jest 러너로 별도 실행합니다.

```bash
npm run test:contracts
```

## 구조

```text
apps/
  api/src/
    common/                 HTTP 예외·필터·middleware
    health/                 프로세스 확인 endpoint
    issue/                  HTTP feature controller·service·type
    main.ts
    api.module.ts
  batch/src/
    job/databaseCheck/      DB 확인 작업
    runner/                 작업 선택·실행
    main.ts
    batch.module.ts
libs/core/src/
  issue/
    domain/                 issue entity·VO·IssueException
    repository/              issue port·MikroORM adapter 위치
  article/
    domain/                 article entity·VO 위치
    repository/              article port·MikroORM adapter 위치
  common/
    entity/                 공통 entity 기반
    exception/               DomainException·API ErrorCode 기반
    id/                      UUIDv7 ID 생성기
    database/                MikroORM/PostgreSQL 설정·migration 위치
    logging/                 Pino 설정
    transaction/             TransactionManager·MikroORM adapter
  core.module.ts             공통 adapter 조립
  index.ts                   public export
```

소스 import alias는 `@newtine/api/*`, `@newtine/batch/*`, `@newtine/core/*`를 사용한다. 앱 root
barrel은 두지 않아 api와 batch 사이의 직접 의존을 만들지 않는다.

세부 경계와 보류 범위는 [기본 틀 설계](docs/design/nestjs-foundation-design.html), 실제 구현 상태와 검증 증거는 [구현 제어 문서](docs/design/nestia-migration-implementation.html)에서 확인합니다.

최근 실패 처리·운영 DB 설정 보완은 [견고성 구현 기록](docs/design/foundationRobustness.implementation.html)을 참고합니다.

로그 적용 설계와 실제 구현 상태는 [구조화 로그 설계](docs/design/logging.design.html), [구현 제어 기록](docs/design/logging.implementation.html)에서 확인합니다.

## 설계 문서

[설계 안내](docs/design/README.md)에서 확정 범위와 남은 결정을 먼저 확인합니다.

| 문서                                                  | 내용                                               |
| ----------------------------------------------------- | -------------------------------------------------- |
| [요구사항](docs/design/requirements.md)               | 서비스 목표, 기능별 유즈케이스와 수용 기준         |
| [ERD](docs/design/erd.md)                             | 19개 테이블의 컬럼 명세, 관계도, 키·제약           |
| [이슈 생성 파이프라인](docs/design/issue-pipeline.md) | LLM 개입 시점, 상태 전이, 중복 판정, 실패 복구     |
| [데이터·응답 계약](docs/design/data-contracts.md)     | 행동·주간 집계·JSON·조회·보존 규칙                 |
| [구현 계획](docs/design/implementation-plan.md)       | 의존 순서, 완료 기준, 테스트 시나리오, 미결정 사항 |
| [백엔드 구현 컨벤션](docs/design/backend-conventions.md) | 패키지·예외·트랜잭션·동시성·인덱스·로깅 원칙 |

기준: 2026-09-12 대화 및 Notion ERD v1.2. 문서 작성은 구현 승인이나 구현 완료를 뜻하지 않습니다.
