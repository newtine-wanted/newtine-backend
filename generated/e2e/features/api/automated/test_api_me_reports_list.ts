import typia from "typia";

import type { ReportListResponse } from "../../../../../apps/api/src/report/type/report.response";
import api from "../../../../api";

export const test_api_me_reports_list = async (connection: api.IConnection) => {
  const output: ReportListResponse =
    await api.functional.me.reports.list(connection);
  typia.assert(output);
};
