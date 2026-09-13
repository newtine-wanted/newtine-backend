import { tags } from 'typia';

export interface PipelineRunCreateRequest {
  query: string & tags.MinLength<1> & tags.MaxLength<100>;
}

type PipelineRunRetryRequestBase = {
  expectedAttempt: number & tags.Type<'uint32'> & tags.Minimum<1>;
};

export type PipelineRunRetryRequest =
  | (PipelineRunRetryRequestBase & {
      scope: 'DISCOVERY';
      failedJobIds?: (string & tags.Format<'uuid'>)[] & tags.MinItems<1>;
    })
  | (PipelineRunRetryRequestBase & {
      scope: 'CONTENT';
      failedJobIds: (string & tags.Format<'uuid'>)[] & tags.MinItems<1>;
    });

export interface PipelineRunInterruptRequest {
  expectedAttempt: number & tags.Type<'uint32'> & tags.Minimum<1>;
  executionId: string & tags.Format<'uuid'>;
}
