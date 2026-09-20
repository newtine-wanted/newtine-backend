# 뉴스 파이프라인 실행

저장소 루트에서 실행한다. Node.js와 프로젝트 의존성, 기존 애플리케이션 테이블과 데이터가 이미 준비된 DB를 사용한다. 기존 DB 초기화나 기본 데이터 재입력은 하지 않는다.

## DB 준비

뉴스 파이프라인은 migration 클래스를 사용하지 않는다. DB 접속 환경변수 `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`를 설정한 후 SQL을 직접 적용한다. 이 변수는 psql용이며 러너의 `DB_*` 설정과 별개다.

```sh
psql -X -v ON_ERROR_STOP=1 -f deploy/db/news-pipeline/001_schema.sql
# 아래 두 파일은 기존 데이터에서 새 파이프라인 테이블을 채우는 선택 작업
psql -X -v ON_ERROR_STOP=1 -f deploy/db/news-pipeline/002_seed_terms.sql
psql -X -v ON_ERROR_STOP=1 -f deploy/db/news-pipeline/004_seed_search.sql
```

첫 파일은 실행 기록 4개·후속 추적·용어·검색용 복사 테이블과 pg_trgm 확장을 만든다. 확장 생성 권한이 필요하다. 기존 서비스 테이블 존재 여부를 먼저 확인하며, 서비스 데이터에는 쓰지 않는다. 기존 파이프라인 테이블에도 적용 가능하며 검증 모드를 AI/RULES_ONLY/TONE으로 맞춘다. 같은 이름의 테이블이 임의로 다른 구조인 경우까지 자동 보정하지는 않는다. 두 번째 파일은 기존 공개 이슈의 명확한 용어 정의만 채우는 선택 사항이다. 기존 용어는 덮어쓰지 않는다. `004_seed_search.sql`은 수집 실행이 없는 상태에서 최근 7일 공개 이슈를 검색용 테이블에 초기 복사한다. 이때 검색 복사본만 교체하며 원본 데이터는 보존한다.

이전 DDL로 `issues` 검색 인덱스를 만들었다면 `003_remove_legacy_title_index.sql`을 한 번 적용해 제거한다. 새 설치에는 필요 없다. 제목 유사도 조회는 별도 `news_issue_search` 테이블과 전용 인덱스에서 수행한다. 2단계 시작·재개 시 최근 7일 공개 이슈를 복사하며 수정·비공개·삭제를 반영한다. 실행 중 원본 변경은 다음 동기화에서 반영한다. 검증을 통과한 용어 설명은 4단계 완료 시 `news_terms`에 저장되어 다음 생성에서 재사용되며 기존 설명은 덮어쓰지 않는다.

기존 API의 DB 초기화·마이그레이션은 해당 배포 절차를 따른다. 파이프라인 러너는 DB 스키마를 자동 변경하지 않는다.

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
