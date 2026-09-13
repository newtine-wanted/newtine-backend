import typia from "typia";
import type { tags } from "typia";

import type { PipelineRunRetryRequest } from "../../../../../apps/api/src/pipeline/type/pipelineRun.input";
import type { PipelineRunAcceptedResponse } from "../../../../../apps/api/src/pipeline/type/pipelineRun.response";
import api from "../../../../api";

export const test_api_pipeline_runs_retry = async (
  connection: api.IConnection,
) => {
  const output: PipelineRunAcceptedResponse =
    await api.functional.pipeline.runs.retry(
      connection,
      typia.random<string & tags.MinLength<1>>(),
      typia.random<PipelineRunRetryRequest>(),
    );
  typia.assert(output);
};
