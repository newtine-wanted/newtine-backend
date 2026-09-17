import type { UuidV7 } from '../common/id/uuidV7.generator.js';

export type ReportStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export interface ReportPeriod {
  start: string;
  end: string;
  startAt: string;
  endAt: string;
}
export interface ReportIssue {
  issueId: UuidV7;
  title: string;
  categoryCode: string;
  categoryName: string;
  categoryOrder: number;
  summary: string;
  summaryLines: string[];
}
export interface ReportCategory {
  categoryCode: string;
  displayName: string;
  count: number;
}
export interface ReportInput {
  version: 1;
  capturedAt: string;
  issues: ReportIssue[];
  categoryCounts: ReportCategory[];
  excludedCount: number;
  hash: string;
}
export interface ReportRelatedCandidate extends ReportIssue {
  sourceIssueId: UuidV7;
}
export interface ReportCandidates {
  capturedAt: string;
  related: ReportRelatedCandidate[];
  major: ReportIssue[];
  majorCategoryCodes: string[];
  relatedUnavailable: boolean;
}
export interface ReportConnection {
  label: string;
  title: string;
  description: string;
  issueIds: UuidV7[];
}
export interface ReportRelatedIssue extends ReportIssue {
  sourceIssueId: UuidV7;
  reason: string;
}
export interface ReportContent {
  schemaVersion: 1;
  analysisStatus: 'READY' | 'INSUFFICIENT_DATA' | 'NO_CONNECTION';
  issueCount: number;
  minimumIssueCount: 5;
  categoryCounts: ReportCategory[];
  connections: ReportConnection[];
  evidenceIssues: ReportIssue[];
  relatedIssues: ReportRelatedIssue[];
  majorIssues: ReportIssue[];
  majorIssueCategoryCodes: string[];
  majorIssuesStatus: 'READY' | 'NO_INTEREST' | 'NO_CANDIDATES';
  recommendationsStatus: 'READY' | 'PARTIAL';
  recommendationCapturedAt: string;
}
export interface ReportRecord {
  id: UuidV7;
  userId: UuidV7;
  period: ReportPeriod;
  status: ReportStatus;
  input: ReportInput;
  candidates: ReportCandidates | null;
  content: ReportContent | null;
  attempt: number;
  leaseToken: UuidV7 | null;
  leaseExpiresAt: string | null;
  requestedAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  retryable: boolean;
}
export interface ReportClaim extends ReportRecord {
  leaseToken: UuidV7;
}
export interface ReportVisibility {
  publicIssueIds: UuidV7[];
  actedIssueIds: UuidV7[];
}
export interface ReportRepository {
  request(userId: UuidV7, period: ReportPeriod, now: Date): Promise<ReportRecord>;
  findOwned(userId: UuidV7, reportId: UuidV7): Promise<ReportRecord | null>;
  listOwned(userId: UuidV7, oldestPeriodStart: string): Promise<ReportRecord[]>;
  findLatestSucceeded(userId: UuidV7): Promise<ReportRecord | null>;
  retry(userId: UuidV7, reportId: UuidV7, now: Date): Promise<ReportRecord>;
  claim(now: Date, leaseMs: number): Promise<ReportClaim | null>;
  heartbeat(claim: ReportClaim, now: Date, leaseMs: number): Promise<boolean>;
  captureCandidates(claim: ReportClaim, now: Date): Promise<ReportCandidates>;
  visibility(userId: UuidV7, issueIds: UuidV7[]): Promise<ReportVisibility>;
  complete(claim: ReportClaim, content: ReportContent, now: Date): Promise<boolean>;
  fail(claim: ReportClaim, code: string, retryable: boolean, now: Date): Promise<boolean>;
}
export const REPORT_REPOSITORY = Symbol('REPORT_REPOSITORY');
export interface ReportUsageStart {
  userId: UuidV7;
  reportId: UuidV7;
  attempt: number;
  leaseToken: UuidV7;
  purpose: string;
  model: string;
  promptVersion: string;
  promptHash: string;
  startedAt: Date;
}
export interface ReportUsageFinish {
  status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  actualCost?: number;
  errorCode?: string;
  finishedAt: Date;
}
export interface AiUsageRepository {
  beginReport(input: ReportUsageStart): Promise<UuidV7>;
  finish(id: UuidV7, result: ReportUsageFinish): Promise<void>;
}
export const AI_USAGE_REPOSITORY = Symbol('AI_USAGE_REPOSITORY');
