import typia from "typia";

import type { PipelineRunCreateRequest } from "../../../../../apps/api/src/pipeline/type/pipelineRun.input";
import type { PipelineRunAcceptedResponse } from "../../../../../apps/api/src/pipeline/type/pipelineRun.response";
import api from "../../../../api";

export const test_api_pipeline_runs_create = async (
  connection: api.IConnection,
) => {
  const output: PipelineRunAcceptedResponse =
    await api.functional.pipeline.runs.create(
      {
        ...connection,
        headers: {
          ...connection.headers,
          ...typia.random<{ "idempotency-key": string }>(),
        },
      },
      typia.random<PipelineRunCreateRequest>(),
    );
  typia.assert(output);
};
