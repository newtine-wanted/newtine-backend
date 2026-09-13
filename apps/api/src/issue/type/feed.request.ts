import { tags } from 'typia';

export interface FeedSessionCreateRequest {
  /** Reserved so the request remains an exact object while carrying no options. */
  readonly marker?: never;
}

export interface FeedBatchRequest {
  batchNo: number & tags.Type<'uint32'>;
}
