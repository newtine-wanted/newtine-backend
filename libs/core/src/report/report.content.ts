import { isUuidV7, type UuidV7 } from '../common/id/uuidV7.generator.js';
import type {
  ReportCandidates,
  ReportContent,
  ReportInput,
  ReportIssue,
  ReportRelatedCandidate,
} from './report.model.js';

/**
 * The report provider only returns references and prose.  The worker owns the
 * input snapshot and hydrates every returned reference before it is persisted.
 * Keeping this boundary separate makes it impossible for a provider to invent
 * a complete issue object (or to receive a member id) as part of generation.
 */
export interface ReportConnectionDraft {
  label: string;
  title: string;
  description: string;
  issueIds: UuidV7[];
}

export interface ReportRelatedDraft {
  issueId: UuidV7;
  sourceIssueId: UuidV7;
  reason: string;
}

export interface ReportContentDraft {
  connections: ReportConnectionDraft[];
  related: ReportRelatedDraft[];
}

export interface ReportSemanticValidation {
  status: 'PASS' | 'FAIL' | 'UNCERTAIN';
  reason: string;
}

export interface ReportProviderUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ReportProviderResult<T> {
  value: T;
  usage?: ReportProviderUsage;
}

export type ReportProviderOutput<T> = T | ReportProviderResult<T>;

export interface ReportProviderInput {
  input: ReportInput;
  candidates: ReportCandidates;
  allowConnections: boolean;
}

export interface ReportValidationInput extends ReportProviderInput {
  draft: ReportContentDraft;
}

export interface ReportContentProvider {
  generate(input: ReportProviderInput): Promise<ReportProviderOutput<ReportContentDraft>>;
  validate(input: ReportValidationInput): Promise<ReportProviderOutput<ReportSemanticValidation>>;
}

export const REPORT_CONTENT_PROVIDER = Symbol('REPORT_CONTENT_PROVIDER');

export type ReportContentValidationErrorCode =
  | 'INVALID_OUTPUT'
  | 'HALLUCINATED_ID'
  | 'DUPLICATE_ID'
  | 'INSUFFICIENT_EVIDENCE'
  | 'INVALID_CONNECTION'
  | 'INVALID_RELATED_ISSUE';

export class ReportContentValidationError extends Error {
  readonly code: ReportContentValidationErrorCode;
  readonly retryable = true;

  constructor(code: ReportContentValidationErrorCode, message: string = code) {
    super(message);
    this.name = 'ReportContentValidationError';
    this.code = code;
  }
}

/**
 * Validate the provider's reference boundary before hydrating the persisted
 * content.  This deliberately does not try to judge factual truth in prose;
 * the provider's semantic validation call is responsible for that second
 * layer while this function enforces the local snapshot boundary.
 */
export function validateReportDraft(
  draft: unknown,
  input: ReportInput,
  candidates: ReportCandidates,
  allowConnections: boolean,
): ReportContentDraft {
  if (!isRecord(draft) || !Array.isArray(draft.connections) || !Array.isArray(draft.related)) {
    throw new ReportContentValidationError('INVALID_OUTPUT');
  }
  if (draft.connections.length > 3 || draft.related.length > 5) {
    throw new ReportContentValidationError('INVALID_OUTPUT');
  }
  if (!allowConnections && draft.connections.length > 0) {
    throw new ReportContentValidationError('INVALID_CONNECTION');
  }

  const inputById = new Map(input.issues.map((issue) => [issue.issueId, issue]));
  const relatedById = new Map(
    candidates.related.map((candidate) => [candidate.issueId, candidate]),
  );
  const connectionDrafts = draft.connections.map((value) => validateConnection(value, inputById));
  const relatedDrafts = draft.related.map((value) =>
    validateRelated(value, inputById, relatedById),
  );
  if (new Set(relatedDrafts.map((related) => related.issueId)).size !== relatedDrafts.length) {
    throw new ReportContentValidationError('DUPLICATE_ID');
  }
  return { connections: connectionDrafts, related: relatedDrafts };
}

export function buildReportContent(
  input: ReportInput,
  candidates: ReportCandidates,
  draft: ReportContentDraft,
  now: Date,
): ReportContent {
  const issueById = new Map(input.issues.map((issue) => [issue.issueId, issue]));
  const candidateById = new Map(
    candidates.related.map((candidate) => [candidate.issueId, candidate]),
  );
  const evidenceIds = unique(draft.connections.flatMap((connection) => connection.issueIds)).filter(
    (id) => issueById.has(id),
  );
  const evidenceIssues = evidenceIds.flatMap((id) => {
    const issue = issueById.get(id);
    return issue === undefined ? [] : [issue];
  });
  const relatedIssues = draft.related.flatMap((related) => {
    const candidate = candidateById.get(related.issueId);
    if (candidate === undefined) return [];
    return [toRelatedIssue(candidate, related.reason)];
  });
  const issueCount = input.issues.length;
  const analysisStatus: ReportContent['analysisStatus'] =
    issueCount < 5
      ? 'INSUFFICIENT_DATA'
      : draft.connections.length === 0
        ? 'NO_CONNECTION'
        : 'READY';
  const majorIssuesStatus: ReportContent['majorIssuesStatus'] =
    input.categoryCounts.length === 0
      ? 'NO_INTEREST'
      : candidates.major.length === 0
        ? 'NO_CANDIDATES'
        : 'READY';

  return {
    schemaVersion: 1,
    analysisStatus,
    issueCount,
    minimumIssueCount: 5,
    categoryCounts: input.categoryCounts.map((category) => ({ ...category })),
    connections: draft.connections.map((connection) => ({
      ...connection,
      issueIds: [...connection.issueIds],
    })),
    evidenceIssues,
    relatedIssues,
    majorIssues: candidates.major.map(cloneIssue),
    majorIssueCategoryCodes: [...candidates.majorCategoryCodes],
    majorIssuesStatus,
    recommendationsStatus:
      candidates.relatedUnavailable || input.issues.length === 0 ? 'PARTIAL' : 'READY',
    recommendationCapturedAt: candidates.capturedAt || now.toISOString(),
  };
}

function validateConnection(
  value: unknown,
  inputById: ReadonlyMap<UuidV7, ReportIssue>,
): ReportConnectionDraft {
  if (!isRecord(value)) throw new ReportContentValidationError('INVALID_CONNECTION');
  const label = nonEmptyText(value.label, 'label');
  const title = nonEmptyText(value.title, 'title');
  const description = nonEmptyText(value.description, 'description');
  if (
    description.length > 2_000 ||
    countSentences(description) < 2 ||
    countSentences(description) > 3
  ) {
    throw new ReportContentValidationError('INVALID_CONNECTION');
  }
  if (!Array.isArray(value.issueIds) || value.issueIds.length < 2) {
    throw new ReportContentValidationError('INSUFFICIENT_EVIDENCE');
  }
  const issueIds = value.issueIds.map((id) => uuidReference(id, inputById));
  if (new Set(issueIds).size !== issueIds.length) {
    throw new ReportContentValidationError('DUPLICATE_ID');
  }
  if (new Set(issueIds).size < 2) {
    throw new ReportContentValidationError('INSUFFICIENT_EVIDENCE');
  }
  return { label, title, description, issueIds };
}

function validateRelated(
  value: unknown,
  inputById: ReadonlyMap<UuidV7, ReportIssue>,
  relatedById: ReadonlyMap<UuidV7, ReportRelatedCandidate>,
): ReportRelatedDraft {
  if (!isRecord(value)) throw new ReportContentValidationError('INVALID_RELATED_ISSUE');
  const issueId = uuidReference(value.issueId, relatedById);
  const sourceIssueId = uuidReference(value.sourceIssueId, inputById);
  const candidate = relatedById.get(issueId);
  if (candidate === undefined || candidate.sourceIssueId !== sourceIssueId) {
    throw new ReportContentValidationError('HALLUCINATED_ID');
  }
  const reason = nonEmptyText(value.reason, 'reason');
  if (reason.length > 600 || reason.includes('\n') || reason.includes('\r')) {
    throw new ReportContentValidationError('INVALID_RELATED_ISSUE');
  }
  return { issueId, sourceIssueId, reason };
}

function uuidReference(value: unknown, known: ReadonlyMap<UuidV7, unknown>): UuidV7 {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new ReportContentValidationError('HALLUCINATED_ID');
  }
  if (!known.has(value)) throw new ReportContentValidationError('HALLUCINATED_ID');
  return value;
}

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReportContentValidationError('INVALID_OUTPUT', `${field} must be non-empty`);
  }
  return value.trim();
}

function countSentences(value: string): number {
  const matches = value.match(/[.!?。！？]+(?=\s|$)/g);
  return matches?.length ?? 0;
}

function toRelatedIssue(
  candidate: ReportRelatedCandidate,
  reason: string,
): ReportContent['relatedIssues'][number] {
  return { ...cloneIssue(candidate), sourceIssueId: candidate.sourceIssueId, reason };
}

function cloneIssue(issue: ReportIssue): ReportIssue {
  return { ...issue, summaryLines: [...issue.summaryLines] };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
