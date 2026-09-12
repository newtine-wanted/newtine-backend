import { DomainException } from '@newtine/core/common/exception/domain.exception.js';

export const IssueExceptionCode = {
  NotFound: 'ISSUE_NOT_FOUND',
} as const;

export type IssueExceptionCodeValue = (typeof IssueExceptionCode)[keyof typeof IssueExceptionCode];

export class IssueException extends DomainException<IssueExceptionCodeValue> {
  readonly domain = 'issue';

  constructor(code: IssueExceptionCodeValue, message: string, options?: ErrorOptions) {
    super(code, message, options);
  }
}
