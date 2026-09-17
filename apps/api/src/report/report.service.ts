import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { UuidV7 } from '@newtine/core';
import {
  REPORT_REPOSITORY,
  type ReportRecord,
  type ReportRepository,
} from '@newtine/core/report/report.model.js';
import {
  eligibleReportPeriod,
  recentReportPeriods,
  reportPeriod,
} from '@newtine/core/report/report.period.js';
import { ReportException } from '@newtine/core/report/report.exception.js';
import type {
  ReportListResponse,
  ReportResponse,
  ReportSummaryResponse,
} from './type/report.response.js';

@Injectable()
export class ReportService {
  constructor(@Inject(REPORT_REPOSITORY) private readonly repository: ReportRepository) {}
  async request(
    userId: UuidV7,
    periodStart: string,
    now = new Date(),
  ): Promise<ReportSummaryResponse> {
    const period = reportPeriod(periodStart);
    if (period.start !== eligibleReportPeriod(now).start)
      throw new ReportException('INVALID_PERIOD');
    try {
      return toReportSummary(await this.repository.request(userId, period, now), now);
    } catch (error: unknown) {
      if (isTransientDatabaseError(error)) {
        throw new ServiceUnavailableException(undefined, { cause: error });
      }
      throw error;
    }
  }
  async list(userId: UuidV7, now = new Date()): Promise<ReportListResponse> {
    const periods = recentReportPeriods(now);
    const [records, latestSucceeded] = await Promise.all([
      this.repository.listOwned(userId, periods[3]!.start),
      this.repository.findLatestSucceeded(userId),
    ]);
    const eligiblePeriod = { ...periods[0]!, timeZone: 'Asia/Seoul' as const };
    return {
      eligiblePeriod,
      nextEligibleAt: new Date(Date.parse(eligiblePeriod.endAt) + 7 * 86_400_000).toISOString(),
      periods: periods.map((period) => ({
        period: { ...period, timeZone: 'Asia/Seoul' },
        report: toOptional(
          records.find((r) => r.period.start === period.start),
          now,
        ),
      })),
      latestSucceeded: toOptional(latestSucceeded ?? undefined, now),
    };
  }
  async get(userId: UuidV7, reportId: UuidV7, now = new Date()): Promise<ReportResponse> {
    const report = await this.repository.findOwned(userId, reportId);
    if (report === null) throw new ReportException('NOT_FOUND');
    const summary = toReportSummary(report, now);
    if (report.status !== 'SUCCEEDED' || report.content === null)
      return {
        ...summary,
        content: null,
        contentAvailability: report.status === 'FAILED' ? 'UNAVAILABLE' : 'PENDING',
      };
    const content = report.content;
    const ids = [
      ...new Set([
        ...content.evidenceIssues.map((i) => i.issueId),
        ...content.connections.flatMap((c) => c.issueIds),
        ...content.relatedIssues.flatMap((i) => [i.issueId, i.sourceIssueId]),
        ...content.majorIssues.map((i) => i.issueId),
      ]),
    ];
    const visibility = await this.repository.visibility(userId, ids);
    const published = new Set(visibility.publicIssueIds);
    const acted = new Set(visibility.actedIssueIds);
    const connections = content.connections.filter((c) =>
      c.issueIds.every((id) => published.has(id)),
    );
    const evidenceIssues = content.evidenceIssues.filter((i) => published.has(i.issueId));
    const relatedIssues = content.relatedIssues.filter(
      (i) => published.has(i.issueId) && published.has(i.sourceIssueId) && !acted.has(i.issueId),
    );
    const majorIssues = content.majorIssues.filter(
      (i) => published.has(i.issueId) && !acted.has(i.issueId),
    );
    const partial =
      connections.length !== content.connections.length ||
      evidenceIssues.length !== content.evidenceIssues.length ||
      relatedIssues.length !== content.relatedIssues.length ||
      majorIssues.length !== content.majorIssues.length;
    return {
      ...summary,
      content: { ...content, connections, evidenceIssues, relatedIssues, majorIssues },
      contentAvailability: partial ? 'PARTIAL' : 'AVAILABLE',
    };
  }
  async retry(userId: UuidV7, reportId: UuidV7, now = new Date()): Promise<ReportSummaryResponse> {
    return toReportSummary(await this.repository.retry(userId, reportId, now), now);
  }
}

function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current === null || typeof current !== 'object') return false;
    const code = (current as { readonly code?: unknown }).code;
    if (code === '40001' || code === '40P01' || code === '55P03' || code === '57014') {
      return true;
    }
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
}

function toOptional(record: ReportRecord | undefined, now: Date): ReportSummaryResponse | null {
  return record === undefined ? null : toReportSummary(record, now);
}
export function toReportSummary(record: ReportRecord, now: Date): ReportSummaryResponse {
  const inWindow = recentReportPeriods(now).some((p) => p.start === record.period.start);
  const retryable =
    record.status === 'FAILED' && record.retryable && record.attempt < 5 && inWindow;
  return {
    reportId: record.id,
    status: record.status,
    period: { ...record.period, timeZone: 'Asia/Seoul' },
    requestedAt: record.requestedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    retryable,
    nextRetryAt: retryable ? new Date(Date.parse(record.updatedAt) + 60_000).toISOString() : null,
    failureCode: record.status === 'FAILED' ? record.lastErrorCode : null,
  };
}
