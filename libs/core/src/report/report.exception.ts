import { DomainException } from '../common/exception/domain.exception.js';
export type ReportExceptionCode =
  | 'INVALID_PERIOD'
  | 'NOT_FOUND'
  | 'RETRY_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'INPUT_LIMIT_EXCEEDED'
  | 'STALE_CLAIM'
  | 'SOURCE_UNAVAILABLE';
export class ReportException extends DomainException<ReportExceptionCode> {
  readonly domain = 'report';
  constructor(code: ReportExceptionCode) {
    const messages: Record<ReportExceptionCode, string> = {
      INVALID_PERIOD: '신청 가능한 지난주 기간을 확인해 주세요.',
      NOT_FOUND: '보고서를 찾을 수 없습니다.',
      RETRY_NOT_ALLOWED: '이 보고서는 재시도할 수 없습니다.',
      RATE_LIMITED: '잠시 후 다시 시도해 주세요.',
      INPUT_LIMIT_EXCEEDED: '보고서 분석 가능한 입력 한도를 초과했습니다.',
      STALE_CLAIM: '보고서 작업 소유권이 변경되었습니다.',
      SOURCE_UNAVAILABLE: '보고서 근거를 더 이상 사용할 수 없습니다.',
    };
    super(code, messages[code]);
  }
}
