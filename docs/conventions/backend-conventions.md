# 백엔드 구현 컨벤션

- 기준일: 2026-09-12
- 상태: 초기 골격에 적용
- 범위: `apps/api`, `apps/batch`, `libs/core`와 업무 기능 구현
- 우선순위: 최근 명시적 결정 → 이 문서 → feature별 설계 문서 → 코드의 우연한 현재 상태

이 문서는 초기 골격을 만들며 확정한 경계와 운영 원칙을 모아 둔다. 새 기능을 추가할 때 이
문서와 해당 feature의 설계를 함께 확인한다. 실제 요구사항이나 데이터 계약이 바뀌면 관련 설계와
이 문서를 함께 갱신한다.

## 패키지와 의존성

업무 코드는 feature를 최상위 경계로 둔다.

```text
libs/core/src/
  issue/
    domain/
    repository/
  article/
    domain/
    repository/
  common/
    entity/
    exception/
    id/
    database/
    logging/
    transaction/
  core.module.ts
  index.ts
```

- `issue`, `article` 같은 업무 feature가 자신의 domain과 repository를 함께 소유한다.
- `common`에는 어떤 feature에도 속하지 않는 기반 타입과 DB·logging·transaction 같은 공통 기술
  경계만 둔다. feature 코드를 `common`으로 옮겨 재사용을 가장하지 않는다.
- `core.module.ts`는 공통 adapter를 조립하고 `index.ts`는 공개 export를 제공한다. core가 앱을
  import하거나 `api`와 `batch`가 서로 import하지 않는다.
- 앱의 service는 repository port에만 의존한다. MikroORM repository는 port의 adapter이며
  service가 구체 adapter를 직접 import하지 않는다. 불필요한 `port/adapter` 중첩 폴더는 만들지
  않는다.
- 소스 import alias는 다음을 사용한다.

  ```text
  @newtine/api/*   → apps/api/src/*
  @newtine/batch/* → apps/batch/src/*
  @newtine/core/*  → libs/core/src/*
  ```

  앱 root barrel alias는 만들지 않는다. 같은 폴더의 짧은 `./` import는 유지할 수 있다.

## 파일과 이름

- 자체 파일명은 역할을 점으로 구분한 camelCase로 만든다. 예: `issue.controller.ts`,
  `issue.service.ts`, `issue.entity.ts`, `issue.request.ts`, `issue.repository.ts`,
  `issue.mapper.ts`, `issue.exception.ts`, `uuidV7.generator.ts`.
- 클래스는 PascalCase, 자체 이름에는 하이픈을 쓰지 않는다. `globalExceptionFilter.ts`와
  `HttpRequestContextMiddleware`처럼 이름만으로 역할이 드러나게 한다.
- `unit-of-work`, `requestId.middleware`, `global.exceptionFilter`처럼 역할이 불명확하거나
  하이픈·불필요한 `Id`가 들어간 이름은 사용하지 않는다. 트랜잭션 경계의 이름은
  `TransactionManager`와 `transaction`으로 통일한다.
- `health`처럼 입력과 유즈케이스가 없는 프로세스 확인 endpoint에는 controller만 둔다. 빈
  `type`·`service` 디렉터리를 미리 만들지 않는다.
- request/response와 service 입출력 타입은 feature의 `type` 디렉터리에 둔다. controller가
  API request를 service input으로 바꾸고 service 결과를 API response로 바꾼다. service가
  controller의 request/response 타입을 직접 import하지 않는다.

## API 계약과 예외

- API 입력·출력 계약은 Nestia를 사용하고, 구조 검증은 Typia를 사용한다. 이 선택이 유지되는
  동안 `class-transformer`, `class-validator`, Zod를 중복 도입하지 않는다. 다른 런타임 스키마가
  필요한 경계가 생기면 별도 설계 후 추가한다.
- 사용자 또는 외부 시스템에서 들어오는 입력은 항상 입력 어댑터 경계에서 런타임 검증한다.
  대상은 body·query·path·header·cookie·file과 batch 인자까지 포함한다. TypeScript 타입, mapper,
  DTO 선언만으로 검증을 대신하지 않으며, 서비스·도메인에 도달하기 전에 형식·범위·필수값·허용
  필드를 확인한다. 도메인 불변식 검사는 이 검증과 별도로 유지한다.
- Nestia 입력 decorator에는 해당 계약의 Typia 검증을 명시한다. query·path 입력도 같은 원칙으로
  `TypedQuery`·`TypedParam`에 적용한다.

  ```ts
  import { TypedBody, TypedRoute } from '@nestia/core';
  import typia from 'typia';

  @TypedRoute.Post('search')
  search(
    @TypedBody<IssueSearchRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<IssueSearchRequest>(input),
    })
    request: IssueSearchRequest,
  ): IssueSearchResponse {
    return this.issueSearchService.search(toIssueSearchInput(request));
  }
  ```

  검증 실패는 `INVALID_ARGUMENT`으로 정규화하고 원본 입력과 검증 상세를 응답·로그에 남기지
  않는다. 내부 service를 직접 호출하는 batch·adapter도 외부 입력을 신뢰하지 않고 자체 경계를
  둔다.
- 성공 응답은 결과를 그대로 `application/json`으로 반환한다. `data` envelope를 추가하지
  않는다.
- 실패 응답은 RFC 9457 Problem Details media type인 `application/problem+json`을 사용한다.
  외부 본문은 `title`, `status`, `detail`, `code` 네 필드만 제공한다.
- 프레임워크 `HttpException`의 payload와 요청 URL을 4xx `detail`에 그대로 반사하지 않는다. 400·413의
  승인된 parser 문구와 404의 고정 문구만 사용하고, 나머지는 일반 문구로 정규화한다. 도메인
  예외 message는 사용자에게 보여줄 문구로 작성하고 외부 입력이나 비밀값을 포함하지 않는다.
- 현재 안정적인 문제 문서 URI가 없으므로 `type`과 `instance`를 임의로 넣지 않는다. endpoint
  URL을 `type`에 넣거나 `/problems/...` 같은 가짜 URI를 만들지 않는다. 문제 유형 URI를 운영할
  필요가 생기면 문서 위치와 호환성부터 별도 결정한다.
- 외부 오류 식별자는 API `code`로 관리한다. 도메인 예외는 `IssueException`, `UserException`처럼
  feature별 `Exception` 타입으로 만들고 도메인 코드와 도메인 이름을 소유한다.
- `DomainError`, `ErrorDefinition`, `ApiExceptionDefinition`, `to*Definition` 같은 중복
  추상화는 만들지 않는다. API adapter에서 도메인 예외를 API 오류 정의로 매핑한다.
- 전역 HTTP 처리는 `globalExceptionFilter.ts` 하나가 담당한다. 필터에 logger fallback을
  두지 않고 `PinoLogger`를 필수 주입한다.
- route의 Nestia 실패 선언은 필요한 `ApiException`을 `TypedException<ProblemDetails>` 한 줄씩
  명시한다. `ProblemDetailsResponses` 같은 공통 decorator로 controller를 다시 감싸지 않는다.
  생성된 OpenAPI의 실패 media type 보정은 생성 단계에서 한 번 처리한다.

## ID와 영속성

- 신규 내부 식별자는 `common/id/uuidV7.generator.ts`의 유지보수되는 `uuid` 라이브러리로
  애플리케이션에서 생성한다. UUID 문자열 생성 로직을 직접 구현하지 않는다.
- PostgreSQL에는 문자열이 아닌 `uuid` 타입으로 저장한다. UUIDv7은 시간에 가까운 키 배치와
  범위 탐색에 도움을 줄 수 있지만 전역 순번이나 commit 순서로 취급하지 않는다.
- `requestId`, batch `executionId`, 영속 PK는 의미가 서로 다르다. 생성기를 재사용할 수는 있지만
  하나의 ID를 서로 다른 의미로 저장하거나 외부에서 전달된 값을 영속 ID로 바꾸지 않는다.
- DB가 자동으로 PK를 채번하도록 기본값을 숨기지 않는다. 생성 위치가 애플리케이션인지 DB인지
  바뀌면 마이그레이션과 왕복 검증을 함께 갱신한다.

## 트랜잭션과 외부 시스템

- 최상위 유즈케이스가 하나의 transaction 경계를 소유한다. `TransactionManager.execute` 안에서
  참여 repository를 호출하고 repository는 독립적으로 `flush`·`commit`하지 않는다.
- 중첩 transaction은 기본 지원하지 않는다. 내부 호출이 새 transaction을 열거나 savepoint를
  임의로 만들지 않고 명시적인 `NestedTransactionException`으로 거부한다.
- 외부 API·LLM·검색 공급자 호출은 DB transaction에 포함하지 않는다. 네트워크 지연 때문에 DB
  connection과 lock을 붙잡지 않도록 먼저 외부 호출을 끝내고 짧은 transaction에서 결과를
  저장한다.
- 정말 transaction과 외부 호출의 결합이 필요한 경우에만 별도 설계를 승인한다. timeout,
  idempotency, 재시도, 보상 또는 미확정 상태 복구를 함께 정의하지 않으면 구현하지 않는다.
- DB 설정은 `common/database`의 `createDatabaseOptions`에서 한 번 관리한다. 운영 환경의 필수
  환경변수 누락을 기본 자격증명으로 대체하지 않고, 자동 DB 생성·schema sync를 켜지 않는다.
- 일회성 batch는 작업명을 인자로 받는다. 작업별 `start:batch:<job>` shortcut script를 늘리지
  않고 `npm run start:batch -- databaseCheck`처럼 실행한다.

## 동시성

- 단순한 조건 경쟁은 우선 atomic conditional update로 해결한다. 조건을 `WHERE`에 포함하고
  affected row 수로 성공 여부를 판단한다. 확인과 변경을 애플리케이션의 두 단계로 나누지 않는다.
- atomic update만으로 불변식을 표현할 수 없을 때만 lock을 사용한다. 유즈케이스의 충돌 범위,
  호출 빈도, lock 유지 시간, 접근 순서와 deadlock 가능성을 함께 검토한다.
- 높은 빈도의 경로에 일괄적인 행 잠금을 추가하지 않는다. unique·partial constraint와
  conditional update로 줄일 수 있는 경쟁을 lock으로 해결하지 않는다.
- 이벤트 재전송과 중복 생성은 DB unique 제약, 멱등 키, affected row 검증을 조합해 차단한다.

## 인덱스

- 컬럼마다 인덱스를 만들지 않는다. 실제 조회·정렬·join 조건, 호출 빈도, 선택도, cardinality,
  기존 인덱스와 쓰기 비용을 먼저 확인한다.
- 기존 인덱스로 요구 쿼리가 해결되는지 확인한 뒤 필요한 경우에만 추가한다. 복합 인덱스는
  predicate와 정렬 순서를 기준으로 만들고, partial index는 상태 조건과 중복 방지 효과가
  명확할 때만 사용한다.
- 인덱스는 생성 후 `EXPLAIN`과 실제 지연·쓰기 부하를 확인한다. UUIDv7을 사용한다는 이유만으로
  모든 FK와 시간 컬럼에 인덱스를 자동 추가하지 않는다.

## 로깅과 시간 관측

- 로거는 Pino·nestjs-pino 하나로 통일하고 stdout 구조화 JSON을 사용한다. 개발 환경의 pretty
  출력은 표시 방식만 바꾼다.
- 정상 요청 완료는 자동 로그로 남기지 않는다. 비즈니스적으로 필요한 이벤트와 실패만 명시적으로
  기록하고, 같은 예외를 filter와 middleware에서 중복 기록하지 않는다.
- HTTP 전체 지연은 decorator가 아니라 `HttpRequestContextMiddleware`가 parser 앞에서
  `process.hrtime.bigint()`으로 시작하고 response `finish`/`close`에서 종료한다. 기준을 넘긴
  정상 `2xx/3xx`만 `http.slow` warn으로 기록하며 예외에는 처리 시점의 `durationMs`를 넣는다.
- batch 작업 시간은 `BatchRunner`가 작업 직전부터 완료·실패까지 직접 측정한다. histogram이나
  별도 metrics collector는 필요성이 확인된 뒤 추가한다.
- `requestId`는 서버가 UUIDv7으로 생성하고 `x-request-id`, request context, 로그에 연결한다.
  클라이언트가 보낸 ID를 신뢰하거나 덮어쓰지 않는다. 로그에 요청 body, query 원문, 인증정보,
  임의 객체 전체를 직렬화하지 않는다.
- 5xx 진단은 `common/logging/exceptionDiagnostic.ts`를 사용한다. 예외 message 원문과 stack의
  첫 줄은 기록하지 않으며, cause는 이름·stack frame만 깊이 제한으로 기록한다. 알려진
  password·token·authorization·query 패턴은 `[REDACTED]`로 보정한다. 로그 안전성은 Pino의
  field redaction만으로 충족된다고 가정하지 않는다.

## 프로세스와 검증

- API `listen` 실패는 구조화 로그를 남기고 application context를 닫은 뒤 non-zero 종료 상태를
  설정한다. batch도 작업 성공·실패와 관계없이 `finally`에서 context를 닫는다.
- 생성 계약 검증은 Nestia 공식 생성 명령과 계약 테스트로 수행한다. 단순한 생성 wrapper인
  `contracts-generate.mjs`를 추가하지 않는다. 생성물의 media type 같은 보정이 필요할 때만
  생성 단계의 후처리 스크립트를 둔다.
- TypeScript ESM 테스트의 공통 러너는 Jest다. `jest.config.mjs`와
  `jest.transformer.mjs`가 현재 NodeNext 소스와 path alias를 해석하며, `node:test`를 테스트
  러너로 섞지 않는다.
- 단위 테스트는 순수 규칙과 adapter 경계를 검증하고, integration 테스트는 설정·adapter와 같은
  외부 경계 계약을 검증한다. 실제 PostgreSQL 동작은 격리된 DB가 있을 때 별도 integration으로
  검증한다. API OpenAPI·SDK·e2e 생성 검사는 DB integration과 다른 계약 검증 단계로 구분한다.
- 변경 후 최소 검증은 `npm run format:check`, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`다. API 계약을 건드리면 `npm run contracts:check`도 실행한다.
