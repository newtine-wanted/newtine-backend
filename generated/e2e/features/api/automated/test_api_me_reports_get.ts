import typia from "typia";
import type { tags } from "typia";

import type { ReportUuid } from "../../../../../apps/api/src/report/type/report.request";
import type { ReportResponse } from "../../../../../apps/api/src/report/type/report.response";
import api from "../../../../api";

export const test_api_me_reports_get = async (connection: api.IConnection) => {
  const output: ReportResponse = await api.functional.me.reports.get(
    connection,
    typia.random<ReportUuid & tags.MinLength<1>>(),
  );
  typia.assert(output);
};
