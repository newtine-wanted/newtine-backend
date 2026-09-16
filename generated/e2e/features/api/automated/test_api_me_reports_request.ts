import typia from "typia";

import type { ReportRequest } from "../../../../../apps/api/src/report/type/report.request";
import type { ReportSummaryResponse } from "../../../../../apps/api/src/report/type/report.response";
import api from "../../../../api";

export const test_api_me_reports_request = async (
  connection: api.IConnection,
) => {
  const output: ReportSummaryResponse = await api.functional.me.reports.request(
    connection,
    typia.random<ReportRequest>(),
  );
  typia.assert(output);
};
