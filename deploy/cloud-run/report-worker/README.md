# Report worker 배포 정의

이 문서는 Cloud Run Worker Pool에 report worker를 배포하기 위한 수동 명령 템플릿이다. Cloud Build는 batch 이미지를 Artifact Registry에 push하지만 이 worker pool을 자동으로 생성하거나 갱신하지 않는다.

## 배포 전 확인

- newtine-batch@sha256:DIGEST가 현재 report 코드와 호환되는지 확인한다.
- DB_HOST, DB_PORT, DB_NAME, DB_USER와 Cloud SQL/VPC 연결 방식을 확인한다.
- REPORT_WORKER_SERVICE_ACCOUNT에 Artifact Registry read, Secret Manager access, DB 접속에 필요한 권한이 있는지 확인한다.
- OPENAI_API_KEY와 DB_PASSWORD의 실제 Secret Manager 이름·버전을 확인한다. 값을 명령이나 저장소에 직접 넣지 않는다.
- API와 pipeline worker의 digest·migration 호환성을 확인한다.

## 배포 명령 템플릿

아래 placeholder를 실제 운영 값으로 치환한 뒤 운영 배포 승인 후 실행한다.

    gcloud run worker-pools deploy newtine-report-worker \
      --region asia-northeast3 \
      --image REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/newtine-batch@sha256:DIGEST \
      --command node \
      --args dist/apps/batch/src/main.js,reportWorker \
      --instances 1 \
      --cpu 1 \
      --memory 1Gi \
      --service-account REPORT_WORKER_SERVICE_ACCOUNT \
      --set-env-vars NODE_ENV=production,LOG_FORMAT=json,DB_HOST=DB_HOST,DB_PORT=5432,DB_NAME=DB_NAME,DB_USER=DB_USER,REPORT_AI_MODEL=REPORT_AI_MODEL,REPORT_AI_TIMEOUT_MS=60000,REPORT_WORKER_POLL_MS=1000,REPORT_WORKER_LEASE_MS=180000,REPORT_WORKER_HEARTBEAT_MS=30000,REPORT_WORKER_EXECUTION_TIMEOUT_MS=300000 \
      --update-secrets OPENAI_API_KEY=REPORT_OPENAI_SECRET:latest,DB_PASSWORD=REPORT_DB_PASSWORD_SECRET:latest

args에는 반드시 reportWorker를 포함해야 한다. 인자를 생략하면 batch 컨테이너는 선택된 작업 없이 실패한다.

## 운영 확인

배포 후 다음을 확인한다.

1. revision이 의도한 image digest를 가리키는지 확인한다.
2. batch.report_worker.started와 report claim 로그가 나타나는지 확인한다.
3. daily_reports의 QUEUED 최장 대기시간, 오래된 RUNNING, FAILED/attempt 추세를 확인한다.
4. API가 살아 있어도 worker가 소비 중이라는 뜻은 아니므로 두 상태를 별도로 확인한다.
5. 문제가 있으면 DB 호환성을 확인한 뒤 report worker pool만 이전 digest로 되돌린다.

Cloud Run 컨테이너의 로컬 파일시스템은 영구 저장소가 아니다. 이 worker는 report DB queue만 사용하며 standalone news:pipeline manifest의 클라우드 보관·재개를 제공하지 않는다.
