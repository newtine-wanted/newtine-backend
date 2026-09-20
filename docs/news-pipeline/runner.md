# 뉴스 파이프라인 실행

저장소 루트에서 실행한다. Node.js와 프로젝트 의존성, 기존 애플리케이션 테이블과 데이터가 이미 준비된 DB를 사용한다. 기존 DB 초기화나 기본 데이터 재입력은 하지 않는다.

## DB 준비

뉴스 파이프라인은 migration 클래스를 사용하지 않는다. DB 접속 환경변수 `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`를 설정한 후 SQL을 직접 적용한다. 이 변수는 psql용이며 러너의 `DB_*` 설정과 별개다.

```sh
psql -X -v ON_ERROR_STOP=1 -f deploy/db/news-pipeline/001_schema.sql
npm run build:batch
# 선택: 기존 공개 데이터로 용어·검색 테이블 채우기 (.env 자동 로드)
node scripts/news-pipeline-prepare.mjs all
# 용어만 / 검색만: all 대신 terms / search
```

DDL은 파이프라인 테이블 7개·인덱스·PK/FK/UNIQUE/NOT NULL과 pg_trgm 확장만 정의한다. CHECK는 사용하지 않으며 실행 상태·검증 모드·용어·후속 추적 값 검증은 TypeScript 코드에서 수행한다. 검증 모드는 코드가 명시적으로 저장한다. 기존 서비스 테이블과 데이터는 이미 준비되어 있어야 한다. 확장 생성 권한이 필요하다. 기존 이름의 테이블을 초기화하거나 임의의 옛 구조를 자동 업그레이드하지 않는다.

초기 데이터 처리 규칙은 SQL 대신 TypeScript 코드에 있다. 준비 CLI는 공개 이슈의 명확한 용어 설명만 재사용하고 기존 정의를 덮어쓰지 않는다. 검색 복사본은 최근 7일 공개 이슈로 교체하며 수집 실행 중에는 수동 갱신을 거부한다. 두 작업 모두 기존 서비스 데이터는 조회만 한다. 과거 `002_seed_terms.sql`·`003_seed_search.sql`은 이 CLI로 대체했다.

제목 검색은 별도 `news_issue_search` 테이블의 인덱스를 사용한다. 2단계 시작·재개 시 검색 복사본을 갱신하므로 수동 준비는 선택 사항이다. 실행 중 원본 변경은 다음 동기화에서 반영한다. 검증된 용어는 4단계 완료 시 저장된다.

2단계의 30초 타이머는 실행 주기 설정이 아니라 heartbeat다. 긴 NAVER/LLM 호출 중에도 5분 실행 점유가 만료되어 다른 작업자가 같은 실행을 가져가는 것을 막는다. 종료 시 타이머와 진행 중인 heartbeat를 정리한다.

## 모델 설정

`.env`에 다음을 설정한다.

```dotenv
PIPELINE_AI_MODEL=gpt-5.4-mini-2026-03-17
```

새 러너의 1~4단계 텍스트 호출에 공통 적용하며, 비어 있으면 `apps/batch/src/ai/ai-model.defaults.ts`의 기본값을 사용한다. 기존 워커는 `apps/batch/src/pipeline/pipeline.ai.config.ts`에서 같은 환경변수를 우선 적용하고, 없으면 `config/pipeline-ai.yml`의 단계별 설정을 사용한다. 임베딩 모델은 별도다.

러너는 `.env`를 읽되 이미 설정된 환경변수를 덮어쓰지 않는다. `.env.example`은 기존 main 버전으로 복원했다. DB 연결 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`와 서비스 키를 대상 환경에 맞게 설정한다. 개별 단계 스크립트 호출 시에는 `node --env-file=.env scripts/news-generation.mjs run <수집실행ID>`처럼 환경변수를 직접 로드한다.

## 실행

```sh
npm run build:batch
npm run news:pipeline
# 일부 단계: source는 바로 이전 단계의 실행 ID
npm run news:pipeline -- --from 3 --to 3 --source <수집실행ID>
# 중단 후 재개: 출력된 manifest 경로 사용
npm run news:pipeline -- --resume .local/news-pipeline/<실행폴더>/manifest.json
```

기본은 1~4단계 순차 실행이다. `--output <폴더>`로 출력 위치를 지정할 수 있다. 실행 ID와 완료 상태는 `manifest.json`, 결과·토큰·추정 비용은 `summary.md`와 `summary.json`, 전체 실행의 상세 결과는 `results.md`에 저장한다. 단계별 원본 JSON과 생성·검증 보고서도 하위 폴더에 저장한다.

완료된 DB 실행은 재사용한다. 같은 날 다시 명령을 실행하거나 모델을 바꾸어도 이미 완료된 결과를 강제로 재생성하지 않는다. 보고서 비용은 저장된 실행의 과거 호출을 포함하며 이번 명령의 추가 비용과는 다를 수 있다. 단가가 등록되지 않은 모델은 산정 불가로 표시한다.

재개 시 모델 환경변수는 최초 실행과 같아야 한다. 동일 출력 폴더의 중복 실행은 잠금으로 차단한다. 강제 종료로 `.runner.lock`이 남으면 기록된 PID의 프로세스가 종료됐는지 확인한 뒤 해당 잠금 파일만 지우고 재개한다. 러너는 5단계 공개 처리나 스케줄 등록을 하지 않는다.

```sh
npm run test:news-runner
```
