import { tags } from 'typia';

export type PipelineUuidV7 = string &
  tags.Pattern<'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'>;

export interface PipelineRunCreateRequest {
  query: string & tags.MinLength<1> & tags.MaxLength<100>;
}

type PipelineRunRetryRequestBase = {
  expectedAttempt: number & tags.Type<'uint32'> & tags.Minimum<1>;
};

export type PipelineRunRetryRequest =
  | (PipelineRunRetryRequestBase & {
      scope: 'DISCOVERY';
      failedJobIds?: PipelineUuidV7[] & tags.MinItems<1>;
    })
  | (PipelineRunRetryRequestBase & {
      scope: 'CONTENT';
      failedJobIds: PipelineUuidV7[] & tags.MinItems<1>;
    });

export interface PipelineRunInterruptRequest {
  expectedAttempt: number & tags.Type<'uint32'> & tags.Minimum<1>;
  executionId: PipelineUuidV7;
}
