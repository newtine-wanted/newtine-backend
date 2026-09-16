import { ReportException } from './report.exception.js';
import type { ReportPeriod } from './report.model.js';
const DAY = 86_400_000;
const KST = 9 * 3_600_000;
export function reportPeriod(start: string): ReportPeriod {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new ReportException('INVALID_PERIOD');
  const local = new Date(`${start}T00:00:00Z`);
  if (
    !Number.isFinite(local.getTime()) ||
    local.toISOString().slice(0, 10) !== start ||
    local.getUTCDay() !== 1
  )
    throw new ReportException('INVALID_PERIOD');
  return {
    start,
    end: new Date(local.getTime() + 7 * DAY).toISOString().slice(0, 10),
    startAt: new Date(local.getTime() - KST).toISOString(),
    endAt: new Date(local.getTime() + 7 * DAY - KST).toISOString(),
  };
}
export function eligibleReportPeriod(now: Date): ReportPeriod {
  const local = new Date(now.getTime() + KST);
  const monday =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    ((local.getUTCDay() + 6) % 7) * DAY;
  return reportPeriod(new Date(monday - 7 * DAY).toISOString().slice(0, 10));
}
export function recentReportPeriods(now: Date): ReportPeriod[] {
  const latest = eligibleReportPeriod(now);
  const base = Date.parse(`${latest.start}T00:00:00Z`);
  return [0, 1, 2, 3].map((i) =>
    reportPeriod(new Date(base - i * 7 * DAY).toISOString().slice(0, 10)),
  );
}
