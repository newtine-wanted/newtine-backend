# News Pipeline 기록

뉴스 수집·처리·저장 작업만 기록하는 독립 문서 공간이다.

## 폴더

- `implementation/`: 소단계별 구현 현황과 설계 결정
- `tests/`: 소단계별 테스트 시나리오
- `runs/`: LLM 기능별 모델 비교 실행 기록
- `direction/`: 사용자가 직접 작성하는 방향성 메모. AI는 수정하지 않는다.

LLM 기능은 `runs/<기능명>/` 폴더를 만들고, 동일한 입력으로 여러 모델을 실행한 결과를 기록한 뒤 사용자의 선택을 받는다.

## 상태 표기

- `PLANNED`: 계획만 있음
- `IMPLEMENTED`: 코드 구현 완료
- `LOCAL_VERIFIED`: 로컬 실행 검증 완료
- `PRODUCTION_VERIFIED`: 운영 환경 검증 완료

코드 구현과 실제 실행 성공은 반드시 따로 기록한다.
