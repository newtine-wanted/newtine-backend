import { tags } from 'typia';

export interface IssueInteractionRequest {
  eventId: string & tags.Format<'uuid'>;
  sessionId: string & tags.Format<'uuid'>;
  action: 'LIKE' | 'SKIP' | 'PASS';
}

export interface DetailViewStartRequest {
  sessionId: string & tags.Format<'uuid'>;
}

export interface DetailViewProgressRequest {
  activeMilliseconds: number & tags.Type<'uint32'> & tags.Maximum<1800000>;
}
