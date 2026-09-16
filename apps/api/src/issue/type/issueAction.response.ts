import { tags } from 'typia';

export interface IssueInteractionResponse {
  eventId: string & tags.Format<'uuid'>;
  issueId: string & tags.Format<'uuid'>;
  acceptedAction: 'LIKE' | 'SKIP' | 'PASS';
  acceptedAt: string & tags.Format<'date-time'>;
}

export interface DetailViewStartResponse {
  viewId: string & tags.Format<'uuid'>;
  issueId: string & tags.Format<'uuid'>;
  startedAt: string & tags.Format<'date-time'>;
  expiresAt: string & tags.Format<'date-time'>;
}

export interface DetailViewProgressResponse {
  viewId: string & tags.Format<'uuid'>;
  issueId: string & tags.Format<'uuid'>;
  acceptedActiveMilliseconds: number & tags.Type<'uint32'>;
  totalCreditedMilliseconds: number & tags.Type<'uint32'>;
  dwellScore: 0 | 0.5 | 1;
}
