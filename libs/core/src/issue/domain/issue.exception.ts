import { DomainException } from '@newtine/core/common/exception/domain.exception.js';

export const IssueExceptionCode = {
  NotFound: 'ISSUE_NOT_FOUND',
  FeedSessionNotFound: 'FEED_SESSION_NOT_FOUND',
  FeedSessionExpired: 'FEED_SESSION_EXPIRED',
  FeedBatchConflict: 'FEED_BATCH_CONFLICT',
  InteractionConflict: 'ISSUE_INTERACTION_CONFLICT',
  DetailViewConflict: 'ISSUE_DETAIL_VIEW_CONFLICT',
  DetailViewInvalid: 'ISSUE_DETAIL_VIEW_INVALID',
  DetailViewNotFound: 'ISSUE_DETAIL_VIEW_NOT_FOUND',
  DetailViewExpired: 'ISSUE_DETAIL_VIEW_EXPIRED',
} as const;

export type IssueExceptionCodeValue = (typeof IssueExceptionCode)[keyof typeof IssueExceptionCode];

export class IssueException extends DomainException<IssueExceptionCodeValue> {
  readonly domain = 'issue';

  constructor(code: IssueExceptionCodeValue, message: string, options?: ErrorOptions) {
    super(code, message, options);
  }
}
