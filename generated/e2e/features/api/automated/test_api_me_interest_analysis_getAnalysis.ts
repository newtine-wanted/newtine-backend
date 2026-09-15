import typia from "typia";

import type { InterestAnalysisResponse } from "../../../../../apps/api/src/interest/type/interest.output";
import api from "../../../../api";

export const test_api_me_interest_analysis_getAnalysis = async (
  connection: api.IConnection,
) => {
  const output: InterestAnalysisResponse =
    await api.functional.me.interest_analysis.getAnalysis(connection);
  typia.assert(output);
};
