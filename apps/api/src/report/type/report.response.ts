export interface ReportPeriodResponse {
  start: string;
  end: string;
  startAt: string;
  endAt: string;
  timeZone: 'Asia/Seoul';
}
export interface ReportIssueResponse {
  issueId: string;
  title: string;
  categoryCode: string;
  categoryName: string;
  categoryOrder: number;
  summary: string;
  summaryLines: string[];
}
export interface ReportContentResponse {
  schemaVersion: 1;
  analysisStatus: 'READY' | 'INSUFFICIENT_DATA' | 'NO_CONNECTION';
  issueCount: number;
  minimumIssueCount: 5;
  categoryCounts: { categoryCode: string; displayName: string; count: number }[];
  connections: { label: string; title: string; description: string; issueIds: string[] }[];
  evidenceIssues: ReportIssueResponse[];
  relatedIssues: (ReportIssueResponse & { sourceIssueId: string; reason: string })[];
  majorIssues: ReportIssueResponse[];
  majorIssueCategoryCodes: string[];
  majorIssuesStatus: 'READY' | 'NO_INTEREST' | 'NO_CANDIDATES';
  recommendationsStatus: 'READY' | 'PARTIAL';
  recommendationCapturedAt: string;
}
export interface ReportSummaryResponse {
  reportId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  period: ReportPeriodResponse;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryable: boolean;
  nextRetryAt: string | null;
  failureCode: string | null;
}
export interface ReportResponse extends ReportSummaryResponse {
  content: ReportContentResponse | null;
  contentAvailability: 'AVAILABLE' | 'PARTIAL' | 'PENDING' | 'UNAVAILABLE';
}
export interface ReportListResponse {
  eligiblePeriod: ReportPeriodResponse;
  nextEligibleAt: string;
  periods: { period: ReportPeriodResponse; report: ReportSummaryResponse | null }[];
  latestSucceeded: ReportSummaryResponse | null;
}
