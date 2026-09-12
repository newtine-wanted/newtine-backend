# 구현 설계

- 목적: 확정된 요구사항과 정책을 코드·데이터·실행 경계로 구체화한다.
- 대상: 백엔드 개발자, 콘텐츠 파이프라인 개발자
- 범위: 모듈 구조, 데이터 모델, API 경계, 실행 흐름, 검증 방법

이 디렉터리의 문서는 구현 방법을 설명한다. 선택의 근거와 확정·미확정 상태는 [의사결정 기록](../decisions/README.md),
반복 적용하는 규칙은 [구현 컨벤션](../conventions/README.md), 외부에 약속하는 요구사항과 계약은 [정책과 계약](../policies/README.md)에서
관리한다.

## 읽는 순서

[요구사항](../policies/requirements.md) → [의사결정 기록](../decisions/README.md) → [ERD](erd.md) →
[이슈 생성 파이프라인](issue-pipeline.md) → [구현 계획](implementation-plan.md) → 앱별 설계·구현 제어 문서.

## 문서 목록

| 문서                                                                | 내용                                   |
| ------------------------------------------------------------------- | -------------------------------------- |
| [ERD](erd.md)                                                       | 테이블·관계·키·제약과 영속 ID 설계     |
| [ERD 전체 관계도](erd-full.mmd)                                     | 전체 테이블 관계도                     |
| [이슈 생성 파이프라인](issue-pipeline.md)                           | 후보 판정·상태 전이·실패 복구 흐름     |
| [구현 계획](implementation-plan.md)                                 | 의존 순서·완료 기준·검증 시나리오      |
| [NestJS 초기 골격 설계](nestjs-foundation-design.html)              | API·batch·core 모듈 구조               |
| [NestJS 초기 골격 구현 제어](nestjs-foundation-implementation.html) | 골격 구현 과정과 검증 증거             |
| [Nestia 전환 설계](nestia-migration-design.html)                    | Nestia·Typia 계약 전환 설계            |
| [Nestia 전환 구현 제어](nestia-migration-implementation.html)       | 생성·계약 테스트·NodeNext 검증         |
| [견고성 설계](foundationRobustness.design.html)                     | 설정 실패·HTTP 경계·프로세스 종료 설계 |
| [견고성 구현 제어](foundationRobustness.implementation.html)        | 보완 구현과 검증 결과                  |
| [로깅 설계](logging.design.html)                                    | 구조화 로그·요청 지연 기록 설계        |
| [로깅 구현 제어](logging.implementation.html)                       | 로깅 구현과 검증 결과                  |

구현 제어 문서는 설계 승인 이후 실제 변경과 검증을 기록한다. 새로운 정책을 추가하거나 기존 결정을
바꿀 때는 먼저 [의사결정 기록](../decisions/README.md)을 갱신한다.
