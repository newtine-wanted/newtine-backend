import typia from "typia";
import type { tags } from "typia";

import type { PipelineRunResponse } from "../../../../../apps/api/src/pipeline/type/pipelineRun.response";
import api from "../../../../api";

export const test_api_pipeline_runs_get = async (
  connection: api.IConnection,
) => {
  const output: PipelineRunResponse = await api.functional.pipeline.runs.get(
    connection,
    typia.random<string & tags.MinLength<1>>(),
  );
  typia.assert(output);
};
