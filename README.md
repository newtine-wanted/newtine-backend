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
범위는 [데이터·응답 계약](docs/design/data-contracts.md)과 [백엔드 구현 컨벤션](docs/design/backend-conventions.md)을
참고하세요.

## 구조

```text
apps/
  api/src/
    common/                 HTTP 예외·필터·middleware
    health/                 프로세스 확인 endpoint
    issue/                  issue HTTP feature와 type
    main.ts
    api.module.ts
  batch/src/
    job/databaseCheck/      DB 확인 작업
    runner/                 작업 선택·실행
    main.ts
    batch.module.ts
libs/core/src/
  issue/                    issue domain과 repository 경계
  article/                  article domain과 repository 위치
  common/                   entity·exception·id·database·logging·transaction
  core.module.ts            공통 adapter 조립
  index.ts                  public export
```

core는 feature별로 domain과 repository를 나누고, `common`에는 여러 feature가 공유하는 기술
경계를 둡니다. import alias는 `@newtine/api/*`, `@newtine/batch/*`, `@newtine/core/*`를
사용합니다.

## 문서

[설계 안내](docs/design/README.md)에서 문서 목록과 확정 범위를 확인하세요.

| 문서                                                     | 내용                                    |
| -------------------------------------------------------- | --------------------------------------- |
| [요구사항](docs/design/requirements.md)                  | 서비스 목표와 기능별 수용 기준          |
| [ERD](docs/design/erd.md)                                | 테이블·관계·키·제약                     |
| [이슈 생성 파이프라인](docs/design/issue-pipeline.md)    | 상태 전이·중복 판정·실패 복구           |
| [데이터·응답 계약](docs/design/data-contracts.md)        | API와 데이터 보존 규칙                  |
| [구현 계획](docs/design/implementation-plan.md)          | 구현 순서와 완료 기준                   |
| [백엔드 구현 컨벤션](docs/design/backend-conventions.md) | 패키지·예외·트랜잭션·동시성·인덱스 원칙 |
| [로깅 설계](docs/design/logging.design.html)             | 구조화 로그와 요청 지연 기록            |
| [보안 리뷰](docs/reviews/security.review.html)           | 확인된 보안 항목과 잔여 운영 과제       |

기준: 2026-09-12. 문서 작성은 구현 승인이나 구현 완료를 뜻하지 않습니다.
