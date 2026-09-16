import typia from "typia";
import type { tags } from "typia";

import type { ReportUuid } from "../../../../../apps/api/src/report/type/report.request";
import type { ReportSummaryResponse } from "../../../../../apps/api/src/report/type/report.response";
import api from "../../../../api";

export const test_api_me_reports_retry = async (
  connection: api.IConnection,
) => {
  const output: ReportSummaryResponse = await api.functional.me.reports.retry(
    connection,
    typia.random<ReportUuid & tags.MinLength<1>>(),
  );
  typia.assert(output);
};
