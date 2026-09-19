import { executeReportSql } from './report.sql.js';
import { createHash, randomInt } from 'node:crypto';

import { EntityManager, IsolationLevel } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { generateUuidV7, type UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import { ReportException } from './report.exception.js';
import { recentReportPeriods } from './report.period.js';
import type {
  ReportCandidates,
  ReportCategory,
  ReportClaim,
  ReportConnection,
  ReportContent,
  ReportInput,
  ReportIssue,
  ReportRecord,
  ReportRelatedCandidate,
  ReportRepository,
  ReportVisibility,
  ReportPeriod,
} from './report.model.js';

type Row = Record<string, unknown>;

const MAX_ISSUES = 200;
const MAX_INPUT_BYTES = 1_048_576;
const MAX_RELATED = 5;
const MAX_MAJOR = 5;
const AUTO_ATTEMPT_LIMIT = 3;
const TOTAL_ATTEMPT_LIMIT = 5;
const RETRY_COOLDOWN_MS = 60_000;
const EMBEDDING_DIMENSION = 1_536;
const EMBEDDING_INPUT_VERSION = (model: string): string =>
  `${model}:${EMBEDDING_DIMENSION}:title+integrated_summary`;

interface IssueRow extends Row {
  issue_id: string;
  title: string;
  category_code: string;
  category_display_name: string;
  category_display_order: number;
  integrated_summary: string;
  summary_lines: unknown;
}

interface CandidateMeta extends IssueRow {
  published_at: unknown;
  event_at: unknown;
  freshness_score: number;
  importance_score: number;
  embedding_model: string;
  embedding_input_hash: string;
  embedding_input_version: string;
  embedding_dimension: number;
}

/**
 * PostgreSQL adapter for the request-scoped diagnostic report lifecycle.
 *
 * The worker-facing methods use conditional SQL writes.  A report claim is a
 * capability: report id, attempt and lease token must all match before a
 * worker can heartbeat, persist candidates, complete, or fail the work.
 */
@Injectable()
export class MikroOrmReportRepository implements ReportRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async request(userId: UuidV7, period: ReportPeriod, now: Date): Promise<ReportRecord> {
    // A concurrent first request can lose the unique-index race under
    // REPEATABLE READ.  Retrying the complete transaction lets the winner's
    // row become visible and preserves one report per member/week.
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.entityManager.transactional(
          async (em) => {
            const ownerRows = await executeInTransaction<Row[]>(
              em,
              'select id from users where id = $1::uuid for key share',
              [userId],
            );
            if (ownerRows.length !== 1) throw new ReportException('NOT_FOUND');

            const existingRows = await executeInTransaction<Row[]>(
              em,
              `select * from weekly_reports
                 where user_id = $1 and period_start = $2::date
                 limit 1`,
              [userId, period.start],
            );
            const existing = existingRows[0];
            if (existing !== undefined) return toReportRecord(existing);

            const totalRows = await executeInTransaction<Row[]>(
              em,
              `with latest_events as (
                 select distinct on (e.issue_id)
                        e.issue_id, e.event_type, e.accepted_order, e.created_at, e.id
                   from user_interaction_events e
                  where e.user_id = $1
                    and e.created_at < $2::timestamptz
                  order by e.issue_id, e.accepted_order desc, e.id desc
               )
               select count(*)::int as total_count
                 from latest_events
                where event_type = 'LIKE'
                  and created_at >= $3::timestamptz
                  and created_at < $2::timestamptz`,
              [userId, period.endAt, period.startAt],
            );
            const totalCount = Number(totalRows[0]?.total_count ?? 0);
            if (totalCount > MAX_ISSUES) {
              throw new ReportException('INPUT_LIMIT_EXCEEDED');
            }

            const issueRows = await executeInTransaction<IssueRow[]>(
              em,
              `with latest_events as (
                 select distinct on (e.issue_id)
                        e.issue_id, e.event_type, e.accepted_order, e.created_at, e.id
                   from user_interaction_events e
                  where e.user_id = $1
                    and e.created_at < $2::timestamptz
                  order by e.issue_id, e.accepted_order desc, e.id desc
               )
               select i.id as issue_id,
                      i.title,
                      i.category_code,
                      c.display_name as category_display_name,
                      c.display_order as category_display_order,
                      d.integrated_summary,
                      d.summary_lines
                 from latest_events e
                 join issues i
                   on i.id = e.issue_id
                  and i.publication_status = 'PUBLISHED'
                 join issue_categories c on c.code = i.category_code
                 join issue_details d on d.issue_id = i.id
                where e.event_type = 'LIKE'
                  and e.created_at >= $3::timestamptz
                  and e.created_at < $2::timestamptz
                order by c.display_order, c.code, i.id`,
              [userId, period.endAt, period.startAt],
            );
            const issues = issueRows.flatMap(toReportIssue);
            const excludedCount = totalCount - issues.length;
            const categoryCounts = countCategories(issues);
            const capturedAt = now.toISOString();
            const hash = hashInput({
              version: 1,
              capturedAt,
              issues,
              categoryCounts,
              excludedCount,
            });
            const input: ReportInput = {
              version: 1,
              capturedAt,
              issues,
              categoryCounts,
              excludedCount,
              hash,
            };
            const inputBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
            if (issues.length > MAX_ISSUES || inputBytes > MAX_INPUT_BYTES) {
              throw new ReportException('INPUT_LIMIT_EXCEEDED');
            }

            const id = generateUuidV7();
            const rows = await executeInTransaction<Row[]>(
              em,
              `insert into weekly_reports
                (id, user_id, period_start, period_end, status,
                 input_snapshot, input_version, input_captured_at, input_hash,
                 attempt_count, next_attempt_at, requested_at, created_at,
                 updated_at, retryable)
               values ($1, $2, $3::date, $4::date, 'QUEUED',
                       $5::jsonb, 1, $6::timestamptz, $7,
                       0, $8::timestamptz, $8::timestamptz, $8::timestamptz,
                       $8::timestamptz, false)
               returning *`,
              [id, userId, period.start, period.end, JSON.stringify(input), capturedAt, hash, now],
            );
            const row = rows[0];
            if (row === undefined) throw new Error('weekly_reports insert returned no row');
            return toReportRecord(row);
          },
          { isolationLevel: IsolationLevel.REPEATABLE_READ },
        );
      } catch (error: unknown) {
        if (!isRequestRace(error) || retry === 2) throw error;
      }
    }
    throw new Error('unreachable report request retry state');
  }

  async findOwned(userId: UuidV7, reportId: UuidV7): Promise<ReportRecord | null> {
    const rows = await executeReportSql<Row[]>(
      this.entityManager,
      `select * from weekly_reports where id = $1 and user_id = $2 limit 1`,
      [reportId, userId],
    );
    const row = rows[0];
    return row === undefined ? null : toReportRecord(row);
  }

  async listOwned(userId: UuidV7, oldestPeriodStart: string): Promise<ReportRecord[]> {
    const rows = await executeReportSql<Row[]>(
      this.entityManager,
      `select * from weekly_reports
         where user_id = $1 and period_start >= $2::date
         order by period_start desc, id desc`,
      [userId, oldestPeriodStart],
    );
    return rows.map(toReportRecord);
  }

  async findLatestSucceeded(userId: UuidV7): Promise<ReportRecord | null> {
    const rows = await executeReportSql<Row[]>(
      this.entityManager,
      `select * from weekly_reports
         where user_id = $1 and status = 'SUCCEEDED'
         order by period_start desc, id desc
         limit 1`,
      [userId],
    );
    const row = rows[0];
    return row === undefined ? null : toReportRecord(row);
  }

  async retry(userId: UuidV7, reportId: UuidV7, now: Date): Promise<ReportRecord> {
    return this.entityManager.transactional(async (em) => {
      const rows = await executeInTransaction<Row[]>(
        em,
        `select * from weekly_reports
          where id = $1 and user_id = $2
          for update`,
        [reportId, userId],
      );
      const row = rows[0];
      if (row === undefined) throw new ReportException('NOT_FOUND');
      if (row.status !== 'FAILED' || row.retryable !== true) {
        throw new ReportException('RETRY_NOT_ALLOWED');
      }
      const attempt = Number(row.attempt_count);
      if (attempt >= TOTAL_ATTEMPT_LIMIT) {
        throw new ReportException('RETRY_NOT_ALLOWED');
      }
      const periodStart = dateOnly(row.period_start);
      if (!recentReportPeriods(now).some((period) => period.start === periodStart)) {
        throw new ReportException('RETRY_NOT_ALLOWED');
      }
      const updatedAt = asDate(row.updated_at);
      if (now.getTime() - updatedAt.getTime() < RETRY_COOLDOWN_MS) {
        throw new ReportException('RATE_LIMITED');
      }

      const updatedRows = await executeInTransaction<Row[]>(
        em,
        `update weekly_reports
            set status = 'QUEUED',
                next_attempt_at = $3::timestamptz,
                last_error_code = null,
                lease_token = null,
                lease_expires_at = null,
                heartbeat_at = null,
                completed_at = null,
                updated_at = $3::timestamptz,
                retryable = false
          where id = $1 and user_id = $2
            and status = 'FAILED'
            and retryable = true
            and attempt_count = $4
          returning *`,
        [reportId, userId, now, attempt],
      );
      const updated = updatedRows[0];
      if (updated === undefined) throw new ReportException('RETRY_NOT_ALLOWED');
      return toReportRecord(updated);
    });
  }

  async claim(now: Date, leaseMs: number): Promise<ReportClaim | null> {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new RangeError('leaseMs must be a positive finite number');
    }
    const token = generateUuidV7();
    const expiresAt = new Date(now.getTime() + leaseMs);
    await this.recoverFinishedUsage(now, leaseMs);
    return this.entityManager.transactional(async (em) => {
      const expiredRows = await executeInTransaction<Row[]>(
        em,
        `update weekly_reports
            set status = case when attempt_count < $2 then 'QUEUED' else 'FAILED' end,
                lease_token = null,
                lease_expires_at = null,
                heartbeat_at = null,
                next_attempt_at = case
                  when attempt_count < $2 then least(next_attempt_at, $1::timestamptz)
                  else next_attempt_at
                end,
                last_error_code = coalesce(last_error_code, 'LEASE_EXPIRED'),
                completed_at = case
                  when attempt_count < $2 then null
                  else coalesce(completed_at, $1::timestamptz)
                end,
                updated_at = $1::timestamptz
                ,retryable = attempt_count < $3
          where status = 'RUNNING'
            and lease_expires_at is not null
            and lease_expires_at <= $1::timestamptz
          returning id`,
        [now, AUTO_ATTEMPT_LIMIT, TOTAL_ATTEMPT_LIMIT],
      );
      if (expiredRows.length > 0) {
        const expiredIds = expiredRows.map((row) => String(row.id));
        await executeInTransaction<unknown>(
          em,
          `update ai_usage_records
              set status = 'UNKNOWN',
                  error_code = coalesce(error_code, 'LEASE_EXPIRED'),
                  finished_at = $2::timestamptz
            where weekly_report_id = any($1::uuid[])
              and status = 'RUNNING'
              and finished_at is null`,
          [expiredIds, now],
        );
      }

      const rows = await executeInTransaction<Row[]>(
        em,
        `with picked as (
          select id
            from weekly_reports
           where status = 'QUEUED'
             and next_attempt_at <= $1::timestamptz
             and attempt_count < $2
           order by next_attempt_at, requested_at, id
           limit 1
           for update skip locked
        )
        update weekly_reports r
           set status = 'RUNNING',
               attempt_count = r.attempt_count + 1,
               lease_token = $3::uuid,
               lease_expires_at = $4::timestamptz,
               heartbeat_at = $1::timestamptz,
               started_at = coalesce(r.started_at, $1::timestamptz),
               updated_at = $1::timestamptz,
               retryable = false
          from picked
         where r.id = picked.id
         returning r.*`,
        [now, TOTAL_ATTEMPT_LIMIT, token, expiresAt],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return toReportClaim(row);
    });
  }

  private async recoverFinishedUsage(now: Date, leaseMs: number): Promise<void> {
    await this.entityManager.transactional(async (em) => {
      // Lock terminal reports before their usage rows. This keeps the
      // report-worker cleanup order compatible with account deletion.
      const terminalRows = await executeInTransaction<Row[]>(
        em,
        `select report.id
           from weekly_reports report
          where report.status in ('SUCCEEDED', 'FAILED')
            and exists (
              select 1
                from ai_usage_records usage
               where usage.weekly_report_id = report.id
                 and usage.status = 'RUNNING'
                 and usage.started_at <= $1::timestamptz
                 and usage.purpose in ('report_generation', 'report_semantic_validation')
            )
          order by report.id
          limit 100
          for update skip locked`,
        [new Date(now.getTime() - leaseMs)],
      );
      const reportIds = terminalRows.map((row) => String(row.id));
      if (reportIds.length > 0) {
        await executeInTransaction(
          em,
          `update ai_usage_records
              set status = 'UNKNOWN',
                  error_code = coalesce(error_code, 'USAGE_FINISH_INTERRUPTED'),
                  finished_at = $2::timestamptz
            where weekly_report_id = any($1::uuid[])
              and status = 'RUNNING'
              and started_at <= $3::timestamptz
              and purpose in ('report_generation', 'report_semantic_validation')`,
          [reportIds, now, new Date(now.getTime() - leaseMs)],
        );
      }

      // A deleted report is detached by ON DELETE SET NULL. These rows no
      // longer have a member-owned report row to lock and can be recovered
      // independently of the report claim transaction.
      await executeInTransaction(
        em,
        `update ai_usage_records
            set status = 'UNKNOWN',
                error_code = coalesce(error_code, 'USAGE_FINISH_INTERRUPTED'),
                finished_at = $1::timestamptz
          where weekly_report_id is null
            and status = 'RUNNING'
            and started_at <= $2::timestamptz
            and purpose in ('report_generation', 'report_semantic_validation')`,
        [now, new Date(now.getTime() - leaseMs)],
      );
    });
  }

  async heartbeat(claim: ReportClaim, now: Date, leaseMs: number): Promise<boolean> {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new RangeError('leaseMs must be a positive finite number');
    }
    const rows = await executeReportSql<Row[]>(
      this.entityManager,
      `update weekly_reports
          set lease_expires_at = $4::timestamptz,
              heartbeat_at = $3::timestamptz,
              updated_at = $3::timestamptz
        where id = $1
          and status = 'RUNNING'
          and attempt_count = $2
          and lease_token = $5::uuid
          and lease_expires_at > $3::timestamptz
        returning id`,
      [claim.id, claim.attempt, now, new Date(now.getTime() + leaseMs), claim.leaseToken],
    );
    return rows.length === 1;
  }

  async captureCandidates(claim: ReportClaim, now: Date): Promise<ReportCandidates> {
    return this.entityManager.transactional(async (em) => {
      const reportRows = await executeInTransaction<Row[]>(
        em,
        `select * from weekly_reports
          where id = $1
            and status = 'RUNNING'
            and attempt_count = $2
            and lease_token = $3::uuid
            and lease_expires_at > $4::timestamptz
          for update`,
        [claim.id, claim.attempt, claim.leaseToken, now],
      );
      const report = reportRows[0];
      if (report === undefined) throw new ReportException('STALE_CLAIM');
      const storedCandidates = jsonValue(report.candidates);
      if (storedCandidates !== null && storedCandidates !== undefined) {
        return toReportCandidates(storedCandidates);
      }

      const input = toReportInput(report.input_snapshot);
      const sourceIds = input.issues.map((issue) => issue.issueId);
      const sourceRows = await executeInTransaction<CandidateMeta[]>(
        em,
        `select i.id as issue_id,
                i.title,
                i.category_code,
                c.display_name as category_display_name,
                c.display_order as category_display_order,
                d.integrated_summary,
                d.summary_lines,
                e.model as embedding_model,
                e.input_hash as embedding_input_hash,
                e.input_version as embedding_input_version,
                e.dimension as embedding_dimension,
                i.published_at,
                i.event_at,
                i.freshness_score,
                i.importance_score
           from issues i
           join issue_categories c on c.code = i.category_code
           join issue_details d on d.issue_id = i.id
      left join issue_embeddings e on e.issue_id = i.id
          where i.id = any($1::uuid[])
            and i.publication_status = 'PUBLISHED'`,
        [sourceIds],
      );
      const sourceSnapshots = new Map<string, ReportIssue>(
        input.issues.map((issue) => [issue.issueId, issue]),
      );
      const validSources = sourceRows.filter((row) => {
        const snapshot = sourceSnapshots.get(row.issue_id);
        return (
          snapshot !== undefined &&
          isValidEmbedding(row) &&
          row.embedding_input_hash === embeddingInputHash(snapshot.title, snapshot.summary)
        );
      });
      const validSourceIds = validSources.map((row) => row.issue_id);
      const sourceModels = [...new Set(validSources.map((row) => row.embedding_model))];

      const categoryOrders = new Map(
        input.issues.map((issue) => [issue.categoryCode, issue.categoryOrder]),
      );
      const categoryCounts = [...input.categoryCounts].sort(
        (a, b) =>
          b.count - a.count ||
          (categoryOrders.get(a.categoryCode) ?? 0) - (categoryOrders.get(b.categoryCode) ?? 0) ||
          a.categoryCode.localeCompare(b.categoryCode),
      );
      const maxCategoryCount = categoryCounts[0]?.count ?? 0;
      const majorCategoryCodes =
        maxCategoryCount <= 0
          ? []
          : categoryCounts
              .filter((category) => category.count === maxCategoryCount)
              .map((category) => category.categoryCode);
      // Candidate metadata is read once at the first worker attempt.  The
      // vector comparison below still executes in PostgreSQL so the shared
      // pgvector representation, rather than a lossy JS implementation,
      // determines similarity.
      const candidateRows = await executeInTransaction<CandidateMeta[]>(
        em,
        `with eligible as materialized (
          select i.id, i.category_code, i.importance_score, i.freshness_score,
                 i.event_at, i.published_at, i.title, d.integrated_summary
            from issues i join issue_details d on d.issue_id = i.id
           where i.publication_status = 'PUBLISHED'
             and not (i.id = any($2::uuid[]))
             and not exists (select 1 from user_interaction_events a
                              where a.user_id = $1 and a.issue_id = i.id)
        ), related_ids as (
          select ranked.id, max(ranked.similarity) as similarity
            from issue_embeddings s
            cross join lateral (
              select c.issue_id as id, 1 - (s.embedding <=> c.embedding) as similarity
                from issue_embeddings c join eligible i on i.id = c.issue_id
               where c.model = s.model and c.dimension = $3
                 and c.input_version = c.model || ':' || $3::text || ':title+integrated_summary'
                 and c.input_hash = encode(sha256(convert_to(i.title || E'\\n' || i.integrated_summary, 'UTF8')), 'hex')
               order by s.embedding <=> c.embedding, c.issue_id desc limit 10
            ) ranked
           where s.issue_id = any($4::uuid[])
           group by ranked.id order by max(ranked.similarity) desc nulls last, ranked.id desc limit 50
        ), major_ranked as (
          select id, row_number() over (partition by category_code
            order by importance_score desc, freshness_score desc, event_at desc nulls last, id desc) as rank
            from eligible
           where category_code = any($5::text[])
             and published_at >= $6::timestamptz and published_at < $7::timestamptz
             and (importance_score >= 0.7 or freshness_score >= 0.7)
        )
        select i.id as issue_id,
                i.title,
                i.category_code,
                c.display_name as category_display_name,
                c.display_order as category_display_order,
                d.integrated_summary,
                d.summary_lines,
                e.model as embedding_model,
                e.input_hash as embedding_input_hash,
                e.input_version as embedding_input_version,
                e.dimension as embedding_dimension,
                i.published_at,
                i.event_at,
                i.freshness_score,
                i.importance_score
           from issues i
           join issue_categories c on c.code = i.category_code
           join issue_details d on d.issue_id = i.id
      left join issue_embeddings e on e.issue_id = i.id
          where i.id in (select id from related_ids union select id from major_ranked where rank <= 10)`,
        [
          claim.userId,
          sourceIds,
          EMBEDDING_DIMENSION,
          validSourceIds,
          majorCategoryCodes,
          claim.period.startAt,
          claim.period.endAt,
        ],
      );
      const sourceIdSet = new Set<string>(sourceIds);
      const validCandidateRows = candidateRows.filter(
        (row) =>
          isValidEmbedding(row) &&
          sourceModels.includes(row.embedding_model) &&
          !sourceIdSet.has(row.issue_id),
      );
      const validCandidateIds = validCandidateRows.map((row) => row.issue_id);
      const scoredRows =
        validSourceIds.length === 0 || validCandidateIds.length === 0
          ? []
          : await executeInTransaction<Row[]>(
              em,
              `with scored as (
                select s.issue_id as source_issue_id,
                       c.issue_id as candidate_issue_id,
                       (1 - (s.embedding <=> c.embedding))::double precision as similarity
                  from issue_embeddings s
                  join issue_embeddings c on c.model = s.model
                 where s.issue_id = any($1::uuid[])
                   and c.issue_id = any($2::uuid[])
                   and s.dimension = $3
                   and c.dimension = $3
              ), ranked as (
                select scored.*,
                       row_number() over (
                         partition by source_issue_id
                         order by similarity desc nulls last, candidate_issue_id desc
                       ) as rank
                  from scored
              )
              select source_issue_id, candidate_issue_id, similarity
                from ranked
               where rank <= 10
               order by similarity desc nulls last, candidate_issue_id desc, source_issue_id desc`,
              [validSourceIds, validCandidateIds, EMBEDDING_DIMENSION],
            );

      const candidateById = new Map(validCandidateRows.map((row) => [row.issue_id, row]));
      const bestRelated = new Map<
        string,
        { row: CandidateMeta; sourceIssueId: string; similarity: number }
      >();
      for (const scored of scoredRows) {
        const candidateId = String(scored.candidate_issue_id);
        const row = candidateById.get(candidateId);
        const sourceIssueId = String(scored.source_issue_id);
        const similarity = Number(scored.similarity);
        if (row === undefined || !Number.isFinite(similarity)) continue;
        const existing = bestRelated.get(candidateId);
        if (
          existing === undefined ||
          similarity > existing.similarity ||
          (similarity === existing.similarity && sourceIssueId > existing.sourceIssueId)
        ) {
          bestRelated.set(candidateId, { row, sourceIssueId, similarity });
        }
      }
      const related: ReportRelatedCandidate[] = [...bestRelated.values()]
        .sort((left, right) => {
          if (left.similarity !== right.similarity) return right.similarity - left.similarity;
          return right.row.issue_id.localeCompare(left.row.issue_id);
        })
        .slice(0, MAX_RELATED)
        .flatMap(({ row, sourceIssueId }) => {
          const issue = toReportIssue(row)[0];
          return issue === undefined ? [] : [{ ...issue, sourceIssueId: sourceIssueId as UuidV7 }];
        });

      const relatedIds = new Set(related.map((item) => item.issueId));
      const major = selectMajorIssues(
        candidateRows,
        majorCategoryCodes,
        report.period_start,
        report.period_end,
        sourceIdSet,
        relatedIds,
      );
      const candidates: ReportCandidates = {
        capturedAt: now.toISOString(),
        related,
        major,
        majorCategoryCodes,
        relatedUnavailable: validSources.length === 0 || scoredRows.length === 0,
      };

      const updatedRows = await executeInTransaction<Row[]>(
        em,
        `update weekly_reports
            set candidates = $4::jsonb,
                updated_at = $5::timestamptz
          where id = $1
            and status = 'RUNNING'
            and attempt_count = $2
            and lease_token = $3::uuid
            and candidates is null
            and lease_expires_at > $5::timestamptz
          returning candidates`,
        [claim.id, claim.attempt, claim.leaseToken, JSON.stringify(candidates), now],
      );
      if (updatedRows.length !== 1) throw new ReportException('STALE_CLAIM');
      return candidates;
    });
  }

  async visibility(userId: UuidV7, issueIds: UuidV7[]): Promise<ReportVisibility> {
    const ids = [...new Set(issueIds)];
    if (ids.length === 0) return { publicIssueIds: [], actedIssueIds: [] };
    const [publicRows, actedRows] = await Promise.all([
      executeReportSql<Row[]>(
        this.entityManager,
        `select id from issues
          where id = any($1::uuid[]) and publication_status = 'PUBLISHED'`,
        [ids],
      ),
      executeReportSql<Row[]>(
        this.entityManager,
        `select distinct issue_id from user_interaction_events
          where user_id = $1 and issue_id = any($2::uuid[])`,
        [userId, ids],
      ),
    ]);
    const publicSet = new Set(publicRows.map((row: Row) => String(row.id)));
    const actedSet = new Set(actedRows.map((row: Row) => String(row.issue_id)));
    return {
      publicIssueIds: ids.filter((id) => publicSet.has(id)),
      actedIssueIds: ids.filter((id) => actedSet.has(id)),
    };
  }

  async complete(claim: ReportClaim, content: ReportContent, now: Date): Promise<boolean> {
    return this.entityManager.transactional(async (em) => {
      const rows = await executeInTransaction<Row[]>(
        em,
        `select r.* from weekly_reports r
          join users u on u.id = r.user_id
         where r.id = $1
           and r.status = 'RUNNING'
           and r.attempt_count = $2
           and r.lease_token = $3::uuid
           and r.lease_expires_at > $4::timestamptz
         for update of r`,
        [claim.id, claim.attempt, claim.leaseToken, now],
      );
      const row = rows[0];
      if (row === undefined) return false;
      const input = toReportInput(row.input_snapshot);
      validateReportContent(content, input, jsonValue(row.candidates));
      const inputIds = input.issues.map((issue) => issue.issueId);
      // Input evidence must stay public through commit. Recommendations are
      // optional and are filtered against current visibility at read time.
      const requiredPublicIds = [...new Set(inputIds)];
      if (requiredPublicIds.length > 0) {
        const publicRows = await executeInTransaction<Row[]>(
          em,
          `select i.id from issues i
             join issue_details d on d.issue_id = i.id
            where i.id = any($1::uuid[])
              and i.publication_status = 'PUBLISHED'
            order by i.id for share of i`,
          [requiredPublicIds],
        );
        if (publicRows.length !== requiredPublicIds.length) {
          throw new ReportException('SOURCE_UNAVAILABLE');
        }
      }
      const contentBytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
      if (contentBytes > MAX_INPUT_BYTES) throw new ReportException('INPUT_LIMIT_EXCEEDED');

      const updatedRows = await executeInTransaction<Row[]>(
        em,
        `update weekly_reports
            set status = 'SUCCEEDED',
                content = $4::jsonb,
                model = (select model from ai_usage_records where weekly_report_id = $1
                          and status = 'SUCCEEDED' order by started_at desc, id desc limit 1),
                prompt_version = (select prompt_version from ai_usage_records where weekly_report_id = $1
                          and status = 'SUCCEEDED' order by started_at desc, id desc limit 1),
                completed_at = $5::timestamptz,
                updated_at = $5::timestamptz,
                last_error_code = null,
                lease_token = null,
                lease_expires_at = null,
                heartbeat_at = null,
                retryable = false
          where id = $1
            and status = 'RUNNING'
            and attempt_count = $2
            and lease_token = $3::uuid
            and content is null
            and lease_expires_at > $5::timestamptz
          returning id`,
        [claim.id, claim.attempt, claim.leaseToken, JSON.stringify(content), now],
      );
      return updatedRows.length === 1;
    });
  }

  async fail(claim: ReportClaim, code: string, retryable: boolean, now: Date): Promise<boolean> {
    const safeCode = normalizeErrorCode(code);
    const autoRetry = retryable && claim.attempt < AUTO_ATTEMPT_LIMIT;
    const nextAttemptAt = autoRetry
      ? new Date(
          now.getTime() + Math.min(300_000, 2 ** claim.attempt * 1_000) + randomInt(0, 1_001),
        )
      : now;
    const canRetry = retryable && claim.attempt < TOTAL_ATTEMPT_LIMIT;
    const rows = await executeReportSql<Row[]>(
      this.entityManager,
      `update weekly_reports
          set status = case when $3::boolean then 'QUEUED' else 'FAILED' end,
              next_attempt_at = $4::timestamptz,
              last_error_code = $5,
              lease_token = null,
              lease_expires_at = null,
              heartbeat_at = null,
              completed_at = case when $3::boolean then null else $4::timestamptz end,
              updated_at = $8::timestamptz,
              retryable = $6::boolean
        where id = $1
          and status = 'RUNNING'
          and attempt_count = $2
          and lease_token = $7::uuid
          and lease_expires_at > $8::timestamptz
        returning id`,
      [
        claim.id,
        claim.attempt,
        autoRetry,
        nextAttemptAt,
        safeCode,
        canRetry,
        claim.leaseToken,
        now,
      ],
    );
    return rows.length === 1;
  }
}

const executeInTransaction = executeReportSql;

function isRequestRace(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === '23505' || code === '40001' || code === '40P01';
}

function jsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toReportInput(value: unknown): ReportInput {
  return jsonValue(value) as ReportInput;
}

function toReportCandidates(value: unknown): ReportCandidates {
  return jsonValue(value) as ReportCandidates;
}

function toReportRecord(row: Row): ReportRecord {
  const periodStart = dateOnly(row.period_start);
  const periodEnd = dateOnly(row.period_end);
  const periodStartAt = new Date(`${periodStart}T00:00:00.000Z`);
  const periodEndAt = new Date(`${periodEnd}T00:00:00.000Z`);
  const kstOffsetMs = 9 * 60 * 60 * 1_000;
  return {
    id: String(row.id) as UuidV7,
    userId: String(row.user_id) as UuidV7,
    period: {
      start: periodStart,
      end: periodEnd,
      startAt: new Date(periodStartAt.getTime() - kstOffsetMs).toISOString(),
      endAt: new Date(periodEndAt.getTime() - kstOffsetMs).toISOString(),
    },
    status: String(row.status) as ReportRecord['status'],
    input: toReportInput(row.input_snapshot),
    candidates: jsonValue(row.candidates) === null ? null : toReportCandidates(row.candidates),
    content: jsonValue(row.content) as ReportRecord['content'],
    attempt: Number(row.attempt_count ?? 0),
    leaseToken:
      row.lease_token === null || row.lease_token === undefined
        ? null
        : (String(row.lease_token) as UuidV7),
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    requestedAt: asDate(row.requested_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    nextAttemptAt: asDate(row.next_attempt_at).toISOString(),
    lastErrorCode:
      row.last_error_code === null || row.last_error_code === undefined
        ? null
        : String(row.last_error_code),
    retryable: row.retryable === true || row.retryable === 'true',
  };
}

function toReportClaim(row: Row): ReportClaim {
  const report = toReportRecord(row);
  if (report.leaseToken === null) throw new Error('claimed report has no lease token');
  return { ...report, leaseToken: report.leaseToken };
}

function toReportIssue(row: IssueRow): ReportIssue[] {
  const summary = String(row.integrated_summary ?? '').trim();
  const summaryLines = normalizeSummaryLines(jsonValue(row.summary_lines));
  const issueId = String(row.issue_id);
  if (summary.length === 0 || summaryLines.length !== 3 || issueId.length === 0) return [];
  return [
    {
      issueId: issueId as UuidV7,
      title: String(row.title),
      categoryCode: String(row.category_code),
      categoryName: String(row.category_display_name),
      categoryOrder: Number(row.category_display_order),
      summary,
      summaryLines,
    },
  ];
}

function normalizeSummaryLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    .map((line) => line.trim());
}

function countCategories(issues: readonly ReportIssue[]): ReportCategory[] {
  const counts = new Map<string, ReportCategory>();
  for (const issue of issues) {
    const existing = counts.get(issue.categoryCode);
    if (existing === undefined) {
      counts.set(issue.categoryCode, {
        categoryCode: issue.categoryCode,
        displayName: issue.categoryName,
        count: 1,
      });
    } else {
      existing.count += 1;
    }
  }
  return [...counts.values()].sort(compareCategories);
}

function compareCategories(left: ReportCategory, right: ReportCategory): number {
  if (left.count !== right.count) return right.count - left.count;
  const leftOrder = categoryOrder(left.categoryCode);
  const rightOrder = categoryOrder(right.categoryCode);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.categoryCode.localeCompare(right.categoryCode);
}

function categoryOrder(code: string): number {
  const orders: Record<string, number> = {
    housing: 1,
    labor: 2,
    finance: 3,
    welfare: 4,
    education: 5,
    health: 6,
    climate: 7,
    security: 8,
    local: 9,
    politics: 10,
  };
  return orders[code] ?? Number.MAX_SAFE_INTEGER;
}

function hashInput(input: {
  version: 1;
  capturedAt: string;
  issues: readonly ReportIssue[];
  categoryCounts: readonly ReportCategory[];
  excludedCount: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: input.version,
        capturedAt: input.capturedAt,
        issues: input.issues,
        categoryCounts: input.categoryCounts,
        excludedCount: input.excludedCount,
      }),
      'utf8',
    )
    .digest('hex');
}

function embeddingInputHash(title: string, integratedSummary: string): string {
  return createHash('sha256').update(`${title}\n${integratedSummary}`, 'utf8').digest('hex');
}

function isValidEmbedding(row: CandidateMeta): boolean {
  const model = String(row.embedding_model ?? '').trim();
  return (
    model.length > 0 &&
    Number(row.embedding_dimension) === EMBEDDING_DIMENSION &&
    String(row.embedding_input_hash) ===
      embeddingInputHash(String(row.title), String(row.integrated_summary)) &&
    String(row.embedding_input_version) === EMBEDDING_INPUT_VERSION(model)
  );
}

function selectMajorIssues(
  rows: readonly CandidateMeta[],
  categoryCodes: readonly string[],
  periodStart: unknown,
  periodEnd: unknown,
  sourceIds: ReadonlySet<string>,
  relatedIds: ReadonlySet<UuidV7>,
): ReportIssue[] {
  if (categoryCodes.length === 0) return [];
  const start = new Date(`${dateOnly(periodStart)}T00:00:00.000Z`).getTime() - 9 * 60 * 60 * 1_000;
  const end = new Date(`${dateOnly(periodEnd)}T00:00:00.000Z`).getTime() - 9 * 60 * 60 * 1_000;
  const byCategory = new Map<string, CandidateMeta[]>();
  for (const row of rows) {
    const publishedAt = optionalTime(row.published_at);
    if (
      sourceIds.has(row.issue_id) ||
      relatedIds.has(row.issue_id as UuidV7) ||
      !categoryCodes.includes(String(row.category_code)) ||
      publishedAt === null ||
      publishedAt < start ||
      publishedAt >= end ||
      !Number.isFinite(Number(row.importance_score)) ||
      !Number.isFinite(Number(row.freshness_score)) ||
      (Number(row.importance_score) < 0.7 && Number(row.freshness_score) < 0.7)
    ) {
      continue;
    }
    const category = String(row.category_code);
    const bucket = byCategory.get(category);
    if (bucket === undefined) byCategory.set(category, [row]);
    else bucket.push(row);
  }
  for (const bucket of byCategory.values()) {
    bucket.sort((left, right) => {
      const importance = Number(right.importance_score) - Number(left.importance_score);
      if (importance !== 0) return importance;
      const freshness = Number(right.freshness_score) - Number(left.freshness_score);
      if (freshness !== 0) return freshness;
      const eventAt = optionalTime(right.event_at) ?? -Infinity;
      const leftEventAt = optionalTime(left.event_at) ?? -Infinity;
      if (eventAt !== leftEventAt) return eventAt - leftEventAt;
      return right.issue_id.localeCompare(left.issue_id);
    });
  }
  const result: ReportIssue[] = [];
  const positions = new Map<string, number>();
  while (result.length < MAX_MAJOR) {
    let added = false;
    for (const category of categoryCodes) {
      const bucket = byCategory.get(category) ?? [];
      const position = positions.get(category) ?? 0;
      const row = bucket[position];
      if (row === undefined) continue;
      positions.set(category, position + 1);
      const issue = toReportIssue(row)[0];
      if (issue === undefined) continue;
      result.push(issue);
      added = true;
      if (result.length >= MAX_MAJOR) break;
    }
    if (!added) break;
  }
  return result;
}

function validateReportContent(
  content: ReportContent,
  input: ReportInput,
  storedCandidates: unknown,
): void {
  if (
    content.schemaVersion !== 1 ||
    content.issueCount !== input.issues.length ||
    content.minimumIssueCount !== 5 ||
    !['READY', 'INSUFFICIENT_DATA', 'NO_CONNECTION'].includes(content.analysisStatus) ||
    !['READY', 'PARTIAL'].includes(content.recommendationsStatus) ||
    !Array.isArray(content.categoryCounts) ||
    !Array.isArray(content.connections) ||
    !Array.isArray(content.evidenceIssues) ||
    !Array.isArray(content.relatedIssues) ||
    !Array.isArray(content.majorIssues) ||
    !Array.isArray(content.majorIssueCategoryCodes) ||
    !Number.isFinite(Date.parse(content.recommendationCapturedAt))
  ) {
    throw new Error('invalid report content shape');
  }
  if (!sameCategories(content.categoryCounts, input.categoryCounts)) {
    throw new Error('report category counts do not match the input snapshot');
  }
  if (content.analysisStatus === 'READY') {
    if (content.connections.length < 1 || content.connections.length > 3) {
      throw new Error('ready report must contain one to three connections');
    }
  } else if (content.connections.length !== 0) {
    throw new Error('non-ready report cannot contain connections');
  }

  const inputIds = new Set(input.issues.map((issue) => issue.issueId));
  const evidenceIds = new Set(content.evidenceIssues.map((issue) => issue.issueId));
  for (const issue of content.evidenceIssues) {
    if (!inputIds.has(issue.issueId))
      throw new Error('evidence issue is outside the input snapshot');
  }
  for (const connection of content.connections) {
    validateConnection(connection, inputIds);
    for (const issueId of connection.issueIds) evidenceIds.add(issueId);
  }
  if (content.analysisStatus === 'READY' && evidenceIds.size === 0) {
    throw new Error('ready report must reference evidence');
  }

  const candidates = storedCandidates === null ? null : toReportCandidates(storedCandidates);
  const candidateRelatedIds = new Set(candidates?.related.map((issue) => issue.issueId) ?? []);
  const candidateMajorIds = new Set(candidates?.major.map((issue) => issue.issueId) ?? []);
  const relatedIds = new Set<string>();
  for (const issue of content.relatedIssues) {
    if (
      relatedIds.has(issue.issueId) ||
      inputIds.has(issue.issueId) ||
      !candidateRelatedIds.has(issue.issueId) ||
      !inputIds.has(issue.sourceIssueId) ||
      typeof issue.reason !== 'string' ||
      issue.reason.trim().length === 0
    ) {
      throw new Error('related issue is outside the captured candidate set');
    }
    relatedIds.add(issue.issueId);
  }
  if (content.relatedIssues.length > MAX_RELATED) throw new Error('too many related issues');

  const majorIds = new Set<string>();
  for (const issue of content.majorIssues) {
    if (
      majorIds.has(issue.issueId) ||
      inputIds.has(issue.issueId) ||
      relatedIds.has(issue.issueId) ||
      !candidateMajorIds.has(issue.issueId)
    ) {
      throw new Error('major issue is outside the captured candidate set');
    }
    majorIds.add(issue.issueId);
  }
  if (content.majorIssues.length > MAX_MAJOR) throw new Error('too many major issues');
}

function validateConnection(connection: ReportConnection, inputIds: ReadonlySet<UuidV7>): void {
  if (
    typeof connection.label !== 'string' ||
    typeof connection.title !== 'string' ||
    typeof connection.description !== 'string' ||
    connection.label.trim().length === 0 ||
    connection.title.trim().length === 0 ||
    connection.description.trim().length === 0 ||
    !Array.isArray(connection.issueIds) ||
    connection.issueIds.length < 2 ||
    new Set(connection.issueIds).size !== connection.issueIds.length ||
    connection.issueIds.some((issueId) => !inputIds.has(issueId))
  ) {
    throw new Error('invalid report connection');
  }
}

function sameCategories(
  left: readonly ReportCategory[],
  right: readonly ReportCategory[],
): boolean {
  if (left.length !== right.length) return false;
  const normalized = (categories: readonly ReportCategory[]) =>
    [...categories]
      .map((category) => ({
        categoryCode: category.categoryCode,
        displayName: category.displayName,
        count: category.count,
      }))
      .sort((a, b) => a.categoryCode.localeCompare(b.categoryCode));
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function normalizeErrorCode(value: string): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.-]/g, '_')
    .slice(0, 100);
  return normalized.length === 0 ? 'UNKNOWN' : normalized;
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '');
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function asDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('invalid timestamp in report row');
  return date;
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : asDate(value).toISOString();
}

function optionalTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const time = asDate(value).getTime();
  return Number.isFinite(time) ? time : null;
}
