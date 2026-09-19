import { createHash } from 'node:crypto';
import { EntityManager } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { executePostgresSql } from '@newtine/core/common/database/postgresSql.js';
import { generateUuidV7, isUuidV7, type UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import {
  PipelineException,
  PipelineExceptionCode,
} from '@newtine/core/pipeline/domain/pipeline.exception.js';
import { MAX_FAILED_JOB_IDS } from '@newtine/core/pipeline/domain/pipeline.limits.js';
import { isPipelineCategoryCode } from '@newtine/core/pipeline/domain/pipeline.types.js';
import {
  validateGeneratedContent,
  validateSemanticResult,
} from '@newtine/core/pipeline/domain/pipeline.validator.js';
import { normalizePipelineArticleUrl } from '@newtine/core/pipeline/domain/pipeline.url.js';
import { AiUsageRecordEntity } from '@newtine/core/pipeline/repository/mikroOrm/aiUsageRecord.entity.js';
import type {
  DiscoveredArticle,
  DiscoveryOutcome,
  ExistingIssueSummary,
  FetchedArticle,
  GeneratedIssueContent,
  PipelineEmbeddingTask,
  PipelineJobRecord,
  PipelineJobStage,
  PipelineRunSnapshot,
  PipelineRunWork,
  PipelineUsageSummary,
  SemanticValidationResult,
  UsageRecordInput,
} from '@newtine/core/pipeline/domain/pipeline.types.js';
import type {
  EnqueuePipelineRunInput,
  InterruptPipelineRunInput,
  PipelineRunRepository,
  RegisterIssueInput,
  RegisterIssueResult,
  RetryPipelineRunInput,
} from './pipeline.repository.js';

type Row = Record<string, unknown>;

function executeInTransaction<T>(
  em: EntityManager,
  query: string,
  params: unknown[] = [],
): Promise<T> {
  return executePostgresSql<T>(em, query, params);
}

@Injectable()
export class MikroOrmPipelineRepository implements PipelineRunRepository {
  constructor(private readonly entityManager: EntityManager) {}

  private execute<T>(query: string, params: unknown[] = []): Promise<T> {
    return executePostgresSql<T>(this.entityManager, query, params);
  }

  async enqueue(input: EnqueuePipelineRunInput): Promise<PipelineRunSnapshot> {
    const existing = await this.execute<Row[]>(
      'select * from pipeline_runs where idempotency_key = $1 limit 1',
      [input.idempotencyKey],
    );
    if (existing.length > 0) {
      const row = existing[0]!;
      if (row.request_hash !== input.requestHash) {
        throw new PipelineException(
          PipelineExceptionCode.IdempotencyConflict,
          '멱등 키가 다른 요청에 사용되었습니다.',
        );
      }
      return this.readSnapshot(row);
    }

    const active = await this.execute<Row[]>(
      "select id from pipeline_runs where status in ('QUEUED', 'RUNNING') limit 1",
    );
    if (active.length > 0) {
      throw new PipelineException(
        PipelineExceptionCode.ActiveRunConflict,
        '이미 실행 중인 파이프라인이 있습니다.',
      );
    }

    const id = generateUuidV7();
    try {
      const rows = await this.execute<Row[]>(
        `insert into pipeline_runs
          (id, idempotency_key, request_hash, request_json, status, attempt, candidate_counts, created_at, updated_at)
         values ($1, $2, $3, $4::jsonb, 'QUEUED', 1,
                 '{"discovered":0,"duplicate":0,"uncertain":0,"created":0,"skippedByLimit":0}'::jsonb,
                 now(), now()) returning *`,
        [id, input.idempotencyKey, input.requestHash, JSON.stringify(input.request)],
      );
      return this.toSnapshot(rows[0]!, [], emptyUsageSummary());
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        const row = (
          await this.execute<Row[]>(
            'select * from pipeline_runs where idempotency_key = $1 limit 1',
            [input.idempotencyKey],
          )
        )[0];
        if (row !== undefined) {
          if (row.request_hash === input.requestHash) return this.readSnapshot(row);
          throw new PipelineException(
            PipelineExceptionCode.IdempotencyConflict,
            '멱등 키가 다른 요청에 사용되었습니다.',
          );
        }
        const activeAfterRace = await this.execute<Row[]>(
          "select id from pipeline_runs where status in ('QUEUED', 'RUNNING') limit 1",
        );
        if (activeAfterRace.length > 0) {
          throw new PipelineException(
            PipelineExceptionCode.ActiveRunConflict,
            '이미 실행 중인 파이프라인이 있습니다.',
          );
        }
        throw new PipelineException(
          PipelineExceptionCode.IdempotencyConflict,
          '멱등 키가 다른 요청에 사용되었습니다.',
        );
      }
      throw error;
    }
  }

  async findById(runId: UuidV7): Promise<PipelineRunSnapshot | null> {
    const rows = await this.execute<Row[]>('select * from pipeline_runs where id = $1 limit 1', [
      runId,
    ]);
    const row = rows[0];
    if (row === undefined) return null;
    return this.readSnapshot(row);
  }

  async retry(input: RetryPipelineRunInput): Promise<PipelineRunSnapshot> {
    if (input.failedJobIds !== undefined && input.failedJobIds.length > MAX_FAILED_JOB_IDS) {
      throw new PipelineException(
        PipelineExceptionCode.RetryNotAllowed,
        `failedJobIds는 최대 ${MAX_FAILED_JOB_IDS}개까지 지정할 수 있습니다.`,
      );
    }
    if (
      input.scope === 'CONTENT' &&
      (!Array.isArray(input.failedJobIds) || input.failedJobIds.length === 0)
    ) {
      throw new PipelineException(
        PipelineExceptionCode.RetryNotAllowed,
        'CONTENT 재시도에는 하나 이상의 failedJobIds가 필요합니다.',
      );
    }
    const selected = input.failedJobIds ?? [];
    try {
      await this.entityManager.transactional(async (em) => {
        const row = (
          await executeInTransaction<Row[]>(
            em,
            'select * from pipeline_runs where id = $1 for update',
            [input.runId],
          )
        )[0];
        if (row === undefined)
          throw new PipelineException(
            PipelineExceptionCode.RunNotFound,
            '실행을 찾을 수 없습니다.',
          );
        if (Number(row.attempt) !== input.expectedAttempt) {
          throw new PipelineException(
            PipelineExceptionCode.StaleAttempt,
            '실행 시도가 변경되었습니다. 최신 상태를 다시 확인하세요.',
          );
        }
        if (row.status !== 'FAILED' && row.status !== 'PARTIALLY_SUCCEEDED') {
          throw new PipelineException(
            PipelineExceptionCode.RetryNotAllowed,
            '현재 상태에서는 수동 재시도를 할 수 없습니다.',
          );
        }
        const nextAttempt = input.expectedAttempt + 1;
        if (input.failedJobIds !== undefined) {
          if (selected.length === 0) {
            throw new PipelineException(
              PipelineExceptionCode.RetryNotAllowed,
              '실패한 job만 재시도 대상으로 지정할 수 있습니다.',
            );
          }
          const selectedRows = await executeInTransaction<Row[]>(
            em,
            'select j.id, j.status, i.publication_status from issue_content_jobs j join issues i on i.id = j.issue_id where j.pipeline_run_id = $1 and j.id = any($2::uuid[]) for update',
            [input.runId, selected],
          );
          if (
            selectedRows.length !== selected.length ||
            selectedRows.some(
              (job: Row) => job.status !== 'FAILED' || job.publication_status === 'WITHDRAWN',
            )
          ) {
            throw new PipelineException(
              PipelineExceptionCode.RetryNotAllowed,
              '실패한 job만 재시도 대상으로 지정할 수 있습니다.',
            );
          }
        }
        if (input.scope === 'CONTENT') {
          const unfinishedRows = await executeInTransaction<Row[]>(
            em,
            "select id from issue_content_jobs where pipeline_run_id = $1 and status in ('QUEUED', 'RUNNING') for update",
            [input.runId],
          );
          if (unfinishedRows.length > 0) {
            throw new PipelineException(
              PipelineExceptionCode.RetryNotAllowed,
              '미완료 job이 있으면 CONTENT 재시도 전에 DISCOVERY 재시도가 필요합니다.',
            );
          }
          const failedRows = await executeInTransaction<Row[]>(
            em,
            'select j.id, j.status, i.publication_status from issue_content_jobs j join issues i on i.id = j.issue_id where j.pipeline_run_id = $1 and j.id = any($2::uuid[]) for update',
            [input.runId, selected],
          );
          if (
            failedRows.length === 0 ||
            failedRows.some(
              (job: Row) => job.status !== 'FAILED' || job.publication_status === 'WITHDRAWN',
            )
          ) {
            throw new PipelineException(
              PipelineExceptionCode.RetryNotAllowed,
              '실패한 콘텐츠 job만 CONTENT 재시도 대상으로 지정할 수 있습니다.',
            );
          }
        }
        const updated = await executeInTransaction<Row[]>(
          em,
          `update pipeline_runs set status = 'QUEUED', attempt = $2, retry_scope = $3,
             retry_job_ids = $4::jsonb, execution_id = null,
             current_stage = null, finished_at = null, last_error = null, updated_at = now()
           where id = $1 and attempt = $2 - 1 and status in ('FAILED', 'PARTIALLY_SUCCEEDED') returning id`,
          [input.runId, nextAttempt, input.scope, JSON.stringify(selected)],
        );
        if (updated.length !== 1) {
          throw new PipelineException(
            PipelineExceptionCode.StaleAttempt,
            '실행 시도가 변경되었습니다. 최신 상태를 다시 확인하세요.',
          );
        }
        if (input.scope === 'DISCOVERY') {
          await executeInTransaction<unknown>(
            em,
            `update issue_content_jobs set status = 'QUEUED', stage = 'SEARCH', failure_kind = null,
               last_error = null, attempt = $2 where pipeline_run_id = $1
               and (status in ('QUEUED', 'RUNNING') or
                    (status = 'FAILED' and (failure_kind = 'INTERRUPTED' or ($3::uuid[] is not null and id = any($3::uuid[])))))
               and not exists (select 1 from issues i where i.id = issue_id and i.publication_status = 'WITHDRAWN')`,
            [input.runId, nextAttempt, input.failedJobIds === undefined ? null : selected],
          );
        } else {
          await executeInTransaction<unknown>(
            em,
            `update issue_content_jobs set status = 'QUEUED', stage = 'SEARCH', failure_kind = null,
               last_error = null, attempt = $2 where pipeline_run_id = $1 and status = 'FAILED'
               and ($3::uuid[] is null or id = any($3::uuid[]))
               and not exists (select 1 from issues i where i.id = issue_id and i.publication_status = 'WITHDRAWN')`,
            [input.runId, nextAttempt, input.failedJobIds === undefined ? null : selected],
          );
        }
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new PipelineException(
          PipelineExceptionCode.ActiveRunConflict,
          '다른 파이프라인 실행이 이미 대기 중입니다.',
        );
      }
      throw error;
    }
    const next = await this.findById(input.runId);
    if (next === null)
      throw new PipelineException(PipelineExceptionCode.RunNotFound, '실행을 찾을 수 없습니다.');
    return next;
  }

  async interrupt(input: InterruptPipelineRunInput): Promise<PipelineRunSnapshot> {
    const message = '실행 프로세스 종료가 확인되어 중단 처리되었습니다.';
    await this.entityManager.transactional(async (em) => {
      const row = (
        await executeInTransaction<Row[]>(
          em,
          'select * from pipeline_runs where id = $1 for update',
          [input.runId],
        )
      )[0];
      if (row === undefined)
        throw new PipelineException(PipelineExceptionCode.RunNotFound, '실행을 찾을 수 없습니다.');
      if (Number(row.attempt) !== input.expectedAttempt) {
        throw new PipelineException(
          PipelineExceptionCode.StaleAttempt,
          '실행 시도가 변경되었습니다. 최신 상태를 다시 확인하세요.',
        );
      }
      if (row.status !== 'RUNNING') {
        throw new PipelineException(
          PipelineExceptionCode.RetryNotAllowed,
          'RUNNING 상태의 실행만 중단 처리할 수 있습니다.',
        );
      }
      if (String(row.execution_id) !== input.executionId) {
        throw new PipelineException(
          PipelineExceptionCode.ClaimConflict,
          '실행 소유자가 일치하지 않습니다.',
        );
      }
      const unfinished = await executeInTransaction<Row[]>(
        em,
        `select id from issue_content_jobs
         where pipeline_run_id = $1 and attempt = $2 and status in ('QUEUED', 'RUNNING')
         for update`,
        [input.runId, input.expectedAttempt],
      );
      if (unfinished.length > 0) {
        await executeInTransaction<unknown>(
          em,
          `update issue_content_jobs set status = 'FAILED', failure_kind = 'INTERRUPTED', last_error = $3,
             finished_at = now(), updated_at = now()
           where pipeline_run_id = $1 and attempt = $2 and status in ('QUEUED', 'RUNNING')`,
          [input.runId, input.expectedAttempt, message],
        );
      }
      const counts = (
        await executeInTransaction<Row[]>(
          em,
          `select count(*)::int as total,
                  count(*) filter (where status = 'SUCCEEDED')::int as succeeded,
                  count(*) filter (where status = 'FAILED')::int as failed
           from issue_content_jobs where pipeline_run_id = $1`,
          [input.runId],
        )
      )[0]!;
      const total = Number(counts.total);
      const succeeded = Number(counts.succeeded);
      const failed = Number(counts.failed);
      const status =
        total > 0 && failed === 0 && succeeded === total
          ? 'SUCCEEDED'
          : total > 0 && succeeded > 0
            ? 'PARTIALLY_SUCCEEDED'
            : 'FAILED';
      await executeInTransaction<unknown>(
        em,
        `update pipeline_runs set status = $5, last_error = $3, finished_at = now(), updated_at = now()
         where id = $1 and attempt = $2 and execution_id = $4 and status = 'RUNNING'`,
        [
          input.runId,
          input.expectedAttempt,
          status === 'SUCCEEDED' ? null : message,
          input.executionId,
          status,
        ],
      );
    });
    const snapshot = await this.findById(input.runId);
    if (snapshot === null)
      throw new PipelineException(PipelineExceptionCode.RunNotFound, '실행을 찾을 수 없습니다.');
    return snapshot;
  }

  async claimNext(executionId: UuidV7): Promise<PipelineRunWork | null> {
    const rows = await this.execute<Row[]>(
      `with picked as (
         select id from pipeline_runs where status = 'QUEUED' order by created_at, id
         limit 1 for update skip locked
       )
       update pipeline_runs r set status = 'RUNNING', execution_id = $1,
         started_at = coalesce(r.started_at, now()), updated_at = now()
       from picked where r.id = picked.id returning r.*`,
      [executionId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return { ...(await this.readSnapshot(row)), executionId };
  }

  async saveDiscoveredArticles(
    _runId: UuidV7,
    articles: DiscoveredArticle[],
  ): Promise<DiscoveredArticle[]> {
    const result: DiscoveredArticle[] = [];
    const existingRows = await this.execute<Row[]>(
      'select id, title, description, article_url, naver_url, publisher_name, published_at from articles',
    );
    const existingByNormalizedUrl = new Map<string, Row>(
      existingRows.map((row: Row) => [normalizePipelineArticleUrl(String(row.article_url)), row]),
    );
    for (const article of articles) {
      const normalizedUrl = normalizePipelineArticleUrl(article.sourceUrl);
      const existing = existingByNormalizedUrl.get(normalizedUrl);
      if (existing !== undefined) {
        const updatedRows = await this.execute<Row[]>(
          `update articles set title = $2, description = $3,
             naver_url = coalesce($4, naver_url), publisher_name = $5,
             published_at = coalesce($6, published_at), updated_at = now()
           where id = $1
           returning id, title, description, article_url, naver_url, publisher_name, published_at`,
          [
            existing.id,
            article.title,
            article.description,
            article.naverUrl ?? null,
            article.publisherName,
            article.publishedAt ?? null,
          ],
        );
        const updated = updatedRows[0] ?? existing;
        existingByNormalizedUrl.set(normalizedUrl, updated);
        result.push(this.toArticle(updated));
        continue;
      }
      const id = article.id ?? generateUuidV7();
      const rows = await this.execute<Row[]>(
        `insert into articles (id, title, description, article_url, naver_url, publisher_name, published_at, source_status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'AVAILABLE', now(), now())
         on conflict (article_url) do update set title = excluded.title, description = excluded.description,
           naver_url = coalesce(excluded.naver_url, articles.naver_url), publisher_name = excluded.publisher_name,
           published_at = coalesce(excluded.published_at, articles.published_at), updated_at = now()
         returning id, title, description, article_url, naver_url, publisher_name, published_at`,
        [
          id,
          article.title,
          article.description,
          article.sourceUrl,
          article.naverUrl ?? null,
          article.publisherName,
          article.publishedAt ?? null,
        ],
      );
      const saved = rows[0]!;
      existingByNormalizedUrl.set(normalizedUrl, saved);
      result.push(this.toArticle(saved));
    }
    return result;
  }

  async loadExistingIssues(query: string): Promise<ExistingIssueSummary[]> {
    const rows = await this.execute<Row[]>(
      `select i.id, i.title, i.publication_status, d.integrated_summary
       from issues i left join issue_details d on d.issue_id = i.id
       where i.title ilike '%' || $1 || '%' or coalesce(d.integrated_summary, '') ilike '%' || $1 || '%'
       order by i.created_at desc limit 100`,
      [query],
    );
    return rows.map((row: Row) => ({
      id: String(row.id) as UuidV7,
      title: String(row.title),
      integratedSummary:
        row.integrated_summary === null ? undefined : String(row.integrated_summary),
      publicationStatus: String(
        row.publication_status,
      ) as ExistingIssueSummary['publicationStatus'],
    }));
  }

  async loadIssue(issueId: UuidV7): Promise<ExistingIssueSummary | null> {
    const rows = await this.execute<Row[]>(
      `select i.id, i.title, i.publication_status, d.integrated_summary
       from issues i left join issue_details d on d.issue_id = i.id where i.id = $1 limit 1`,
      [issueId],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : {
          id: String(row.id) as UuidV7,
          title: String(row.title),
          integratedSummary:
            row.integrated_summary === null ? undefined : String(row.integrated_summary),
          publicationStatus: String(
            row.publication_status,
          ) as ExistingIssueSummary['publicationStatus'],
        };
  }

  async loadSeedArticles(issueId: UuidV7): Promise<DiscoveredArticle[]> {
    const rows = await this.execute<Row[]>(
      `select a.id, a.title, a.description, a.article_url, a.naver_url, a.publisher_name, a.published_at
       from issue_seed_articles s join articles a on a.id = s.article_id where s.issue_id = $1 order by a.published_at desc nulls last`,
      [issueId],
    );
    return rows.map((row: Row) => this.toArticle(row));
  }

  async registerIssue(input: RegisterIssueInput): Promise<RegisterIssueResult> {
    if (!isPipelineCategoryCode(input.candidate?.candidate?.categoryCode)) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        '이슈 category code가 올바르지 않습니다.',
      );
    }
    validateSeedLineage(input);
    return this.entityManager.transactional(async (em): Promise<RegisterIssueResult> => {
      const runRows = await executeInTransaction<Row[]>(
        em,
        'select id, status, attempt from pipeline_runs where id = $1 for update',
        [input.runId],
      );
      const run = runRows[0];
      if (
        run === undefined ||
        Number(run.attempt) !== input.attempt ||
        (run.status !== 'QUEUED' && run.status !== 'RUNNING')
      ) {
        throw new PipelineException(
          PipelineExceptionCode.ClaimConflict,
          '현재 실행 시도에서 이슈를 등록할 수 없습니다.',
        );
      }
      const candidateTitle = input.candidate.candidate.title;
      if (typeof candidateTitle !== 'string' || normalizeTitle(candidateTitle).length === 0) {
        throw new PipelineException(
          PipelineExceptionCode.InvalidInput,
          '이슈 제목은 비어 있지 않은 문자열이어야 합니다.',
        );
      }
      const candidateMainTopic = input.candidate.candidate.mainTopic;
      if (
        candidateMainTopic !== undefined &&
        (typeof candidateMainTopic !== 'string' || candidateMainTopic.trim().length === 0)
      ) {
        throw new PipelineException(
          PipelineExceptionCode.InvalidInput,
          '이슈 main topic은 비어 있지 않은 문자열이어야 합니다.',
        );
      }
      const representativeEntityId = input.candidate.candidate.representativeEntityId;
      if (representativeEntityId !== undefined && !isUuidV7(representativeEntityId)) {
        throw new PipelineException(
          PipelineExceptionCode.InvalidInput,
          '이슈 대표 대상 ID가 올바르지 않습니다.',
        );
      }
      const normalizedTitle = normalizeTitle(candidateTitle);
      const duplicateRows = await executeInTransaction<Row[]>(
        em,
        `select id from issues
         where lower(btrim(regexp_replace(title, '[[:space:]]+', ' ', 'g'))) = $1
         order by created_at desc
         limit 1
         for update`,
        [normalizedTitle],
      );
      if (duplicateRows.length > 0) return { outcome: 'duplicate' };

      const issueId = generateUuidV7();
      const jobId = generateUuidV7();
      await executeInTransaction<unknown>(
        em,
        `insert into issues
          (id, category_code, title, main_topic, representative_entity_id, publication_status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'UNPUBLISHED', now(), now())`,
        [
          issueId,
          input.candidate.candidate.categoryCode,
          input.candidate.candidate.title,
          candidateMainTopic?.trim() ?? null,
          representativeEntityId ?? null,
        ],
      );
      for (const article of input.seedArticles) {
        if (article.id === undefined) continue;
        await executeInTransaction<unknown>(
          em,
          'insert into issue_seed_articles (issue_id, article_id) values ($1, $2) on conflict do nothing',
          [issueId, article.id],
        );
      }
      await executeInTransaction<unknown>(
        em,
        `insert into issue_content_jobs (id, issue_id, pipeline_run_id, status, stage, attempt, created_at, updated_at)
         values ($1, $2, $3, 'QUEUED', 'SEARCH', $4, now(), now())`,
        [jobId, issueId, input.runId, input.attempt],
      );
      return {
        outcome: 'created',
        job: {
          id: jobId,
          runId: input.runId,
          issueId,
          status: 'QUEUED',
          stage: 'SEARCH',
          attempt: input.attempt,
        },
      };
    });
  }

  async completeDiscovery(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    outcome: DiscoveryOutcome,
  ): Promise<void> {
    await this.execute(
      `update pipeline_runs set candidate_counts = $4::jsonb, current_stage = 'SEARCH', updated_at = now()
       where id = $1 and attempt = $2 and execution_id = $3 and status = 'RUNNING'`,
      [runId, attempt, executionId, JSON.stringify(outcome)],
    );
  }

  async failRun(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    _failureKind: string,
    message: string,
  ): Promise<void> {
    await this.execute(
      `update pipeline_runs set status = 'FAILED', last_error = $4, finished_at = now(), updated_at = now()
       where id = $1 and attempt = $2 and execution_id = $3 and status = 'RUNNING'`,
      [runId, attempt, executionId, safeError(message)],
    );
  }

  async listJobs(runId: UuidV7, _attempt: number): Promise<PipelineJobRecord[]> {
    void _attempt;
    return this.readJobs(runId);
  }

  async claimJob(
    jobId: UuidV7,
    attempt: number,
    executionId: UuidV7,
  ): Promise<PipelineJobRecord | null> {
    const rows = await this.execute<Row[]>(
      `with owner as (
         select id as owner_run_id from pipeline_runs where execution_id = $3 and status = 'RUNNING' for update
       )
       update issue_content_jobs j set status = 'RUNNING', updated_at = now()
       from owner
       where j.id = $1 and j.attempt = $2 and j.status = 'QUEUED' and j.pipeline_run_id = owner.owner_run_id
       returning j.*`,
      [jobId, attempt, executionId],
    );
    return rows[0] === undefined ? null : this.toJob(rows[0]!);
  }

  async updateRunStage(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    stage: PipelineJobStage,
  ): Promise<void> {
    await this.execute(
      `update pipeline_runs set current_stage = $4, updated_at = now()
       where id = $1 and attempt = $2 and execution_id = $3 and status = 'RUNNING'`,
      [runId, attempt, executionId, stage],
    );
  }

  async updateJobStage(
    jobId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    stage: PipelineJobStage,
  ): Promise<void> {
    await this.execute(
      `with owner as (
         select id from pipeline_runs where execution_id = $3 and status = 'RUNNING' for update
       )
       update issue_content_jobs j set stage = $4, updated_at = now()
       from owner
       where j.id = $1 and j.attempt = $2 and j.status = 'RUNNING' and j.pipeline_run_id = owner.id`,
      [jobId, attempt, executionId, stage],
    );
  }

  async saveJobSuccess(
    jobId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    content: GeneratedIssueContent,
    validation: SemanticValidationResult,
    evidence: FetchedArticle[],
    embeddingModel = 'text-embedding-3-small',
  ): Promise<boolean> {
    if (
      !validateGeneratedContent(content, evidence).ok ||
      !validateSemanticResult(validation, evidence).ok
    ) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidInput,
        '검증을 통과한 콘텐츠만 공개할 수 있습니다.',
      );
    }
    return this.entityManager.transactional(async (em) => {
      const ownerRows = await executeInTransaction<Row[]>(
        em,
        `select r.id from pipeline_runs r
         where r.id = (select pipeline_run_id from issue_content_jobs where id = $1)
           and r.execution_id = $3 and r.attempt = $2 and r.status = 'RUNNING'
         for update`,
        [jobId, attempt, executionId],
      );
      if (ownerRows.length === 0) return false;
      const jobRows = await executeInTransaction<Row[]>(
        em,
        `select j.issue_id, i.publication_status, i.title from issue_content_jobs j
         join issues i on i.id = j.issue_id
         where j.id = $1 and j.attempt = $2 and j.status = 'RUNNING'
           and j.pipeline_run_id = $3
         for update`,
        [jobId, attempt, ownerRows[0]!.id],
      );
      const issueId = jobRows[0]?.issue_id;
      if (issueId === undefined) return false;
      if (jobRows[0]?.publication_status === 'WITHDRAWN') {
        throw new PipelineException(
          PipelineExceptionCode.RetryNotAllowed,
          '공개 중단된 이슈는 자동 재공개하지 않습니다.',
        );
      }
      await executeInTransaction<unknown>(
        em,
        `insert into issue_details (id, issue_id, integrated_summary, summary_lines, viewpoints, glossary, generated_at, updated_at)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, now(), now())
         on conflict (issue_id) do update set integrated_summary = excluded.integrated_summary,
           summary_lines = excluded.summary_lines, viewpoints = excluded.viewpoints, glossary = excluded.glossary, updated_at = now()`,
        [
          generateUuidV7(),
          issueId,
          content.integratedSummary,
          JSON.stringify(content.summaryLines),
          JSON.stringify(content.viewpoints),
          JSON.stringify(content.glossary),
        ],
      );
      const resolvedInputHash = createHash('sha256')
        .update(`${String(jobRows[0]?.title ?? '')}\n${content.integratedSummary}`)
        .digest('hex');
      await executeInTransaction<unknown>(
        em,
        `insert into issue_embedding_tasks
          (id, issue_id, pipeline_run_id, issue_content_job_id, run_attempt, run_execution_id,
           input_hash, model, status, attempt_count, last_error, claim_token,
           claimed_by_process_execution_id, claimed_at, completed_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', 0, null, null, null, null, null, now(), now())
         on conflict (issue_id) do update set
           pipeline_run_id = excluded.pipeline_run_id,
           issue_content_job_id = excluded.issue_content_job_id,
           run_attempt = excluded.run_attempt,
           run_execution_id = case
             when issue_embedding_tasks.input_hash = excluded.input_hash
              and issue_embedding_tasks.model = excluded.model
              and issue_embedding_tasks.status = 'SUCCEEDED'
             then issue_embedding_tasks.run_execution_id
             else excluded.run_execution_id end,
           input_hash = excluded.input_hash,
           model = excluded.model,
           status = case
             when issue_embedding_tasks.input_hash = excluded.input_hash
             and issue_embedding_tasks.model = excluded.model
             and issue_embedding_tasks.status = 'SUCCEEDED'
             then 'SUCCEEDED' else 'PENDING' end,
           last_error = null,
           claim_token = null,
           claimed_by_process_execution_id = null,
           claimed_at = null,
           completed_at = case
             when issue_embedding_tasks.input_hash = excluded.input_hash
              and issue_embedding_tasks.model = excluded.model
              and issue_embedding_tasks.status = 'SUCCEEDED'
             then issue_embedding_tasks.completed_at else null end,
           updated_at = now()`,
        [
          generateUuidV7(),
          issueId,
          ownerRows[0]!.id,
          jobId,
          attempt,
          executionId,
          resolvedInputHash,
          embeddingModel,
        ],
      );
      await executeInTransaction<unknown>(em, 'delete from issue_impacts where issue_id = $1', [
        issueId,
      ]);
      for (const impact of content.impacts) {
        await executeInTransaction<unknown>(
          em,
          `insert into issue_impacts (id, issue_id, target_type, target_value, description, article_ids)
           values ($1, $2, $3, $4, $5, $6::jsonb)
           on conflict (issue_id, target_type, target_value) do update set description = excluded.description, article_ids = excluded.article_ids`,
          [
            generateUuidV7(),
            issueId,
            impact.targetType,
            impact.targetValue,
            impact.description,
            JSON.stringify(impact.articleIds),
          ],
        );
      }
      const verifiedEvidenceIds = collectVerifiedEvidenceIds(content, validation);
      await executeInTransaction<unknown>(em, 'delete from issue_articles where issue_id = $1', [
        issueId,
      ]);
      for (const article of evidence) {
        if (!verifiedEvidenceIds.has(article.articleId)) continue;
        await executeInTransaction<unknown>(
          em,
          'insert into issue_articles (issue_id, article_id) values ($1, $2) on conflict do nothing',
          [issueId, article.articleId],
        );
      }
      await executeInTransaction<unknown>(
        em,
        "update issues set publication_status = 'PUBLISHED', published_at = coalesce(published_at, now()), updated_at = now() where id = $1 and publication_status <> 'WITHDRAWN'",
        [issueId],
      );
      const updatedJobs = await executeInTransaction<Row[]>(
        em,
        `update issue_content_jobs set status = 'SUCCEEDED', stage = 'VALIDATE', failure_kind = null, last_error = null,
         validation_status = $4, validation_reason = $5, finished_at = now(), updated_at = now()
         where id = $1 and attempt = $2 and status = 'RUNNING'
           and exists (select 1 from pipeline_runs r where r.id = pipeline_run_id and r.execution_id = $3 and r.attempt = $2 and r.status = 'RUNNING')
         returning id`,
        [jobId, attempt, executionId, validation.status, validation.reason],
      );
      if (updatedJobs.length !== 1) {
        throw new PipelineException(
          PipelineExceptionCode.ClaimConflict,
          '실행 소유자가 변경되어 결과를 채택하지 않았습니다.',
        );
      }
      await refreshEmbeddingPendingCounts(em);
      return true;
    });
  }

  async saveJobFailure(
    jobId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    failureKind: PipelineJobRecord['failureKind'],
    message: string,
  ): Promise<void> {
    await this.execute(
      `with owner as (
         select id from pipeline_runs where execution_id = $3 and status = 'RUNNING' for update
       )
       update issue_content_jobs j set status = 'FAILED', failure_kind = $4, last_error = $5,
         finished_at = now(), updated_at = now()
       from owner
       where j.id = $1 and j.attempt = $2 and j.status = 'RUNNING' and j.pipeline_run_id = owner.id`,
      [jobId, attempt, executionId, failureKind ?? 'UPSTREAM_ERROR', safeError(message)],
    );
  }

  async completeRun(runId: UuidV7, attempt: number, executionId: UuidV7): Promise<void> {
    await this.execute(
      `with counts as (
         select count(*) filter (where status = 'SUCCEEDED') as succeeded,
                count(*) filter (where status = 'FAILED') as failed,
                count(*) as total from issue_content_jobs where pipeline_run_id = $1
       )
       update pipeline_runs r set status = case when c.failed = 0 then 'SUCCEEDED' when c.succeeded = 0 then 'FAILED' else 'PARTIALLY_SUCCEEDED' end,
         finished_at = now(), updated_at = now()
       from counts c where r.id = $1 and r.attempt = $2 and r.execution_id = $3 and r.status = 'RUNNING' and c.total = c.succeeded + c.failed`,
      [runId, attempt, executionId],
    );
  }

  async recordUsage(input: UsageRecordInput): Promise<void> {
    await this.entityManager.insert(AiUsageRecordEntity, {
      id: generateUuidV7(),
      pipelineRunId: input.runId,
      issueContentJobId: input.jobId ?? null,
      runAttempt: input.runAttempt,
      operation: input.operation,
      purpose: input.purpose,
      promptVersion: input.promptVersion ?? null,
      promptHash: input.promptHash ?? null,
      provider: input.provider,
      status: input.status,
      model: input.model ?? null,
      providerRequestId: input.requestId ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      actualCost: input.actualCost ?? null,
      errorCode: input.errorCode ?? null,
      startedAt: new Date(input.startedAt),
      finishedAt: input.finishedAt === undefined ? null : new Date(input.finishedAt),
      createdAt: new Date(),
    });
  }

  async saveEmbedding(
    issueId: UuidV7,
    title: string,
    integratedSummary: string,
    embedding: number[],
    model: string,
    taskId?: UuidV7,
    claimToken?: UuidV7,
    expectedModel?: string,
  ): Promise<'SAVED' | 'STALE'> {
    if (embedding.length !== 1_536 || embedding.some((value) => !Number.isFinite(value))) {
      throw new PipelineException(
        PipelineExceptionCode.InvalidOutput,
        '임베딩 벡터 차원이 올바르지 않습니다.',
      );
    }
    const inputHash = createHash('sha256').update(`${title}\n${integratedSummary}`).digest('hex');
    const vector = `[${embedding.join(',')}]`;
    return this.entityManager.transactional(async (em) => {
      const taskRows = await executeInTransaction<Row[]>(
        em,
        `select t.id, t.input_hash, t.model, t.status, t.claim_token
         from issue_embedding_tasks t
         join issues i on i.id = t.issue_id and i.publication_status = 'PUBLISHED'
         where t.issue_id = $1 and t.input_hash = $2
         for update`,
        [issueId, inputHash],
      );
      const task = taskRows[0];
      const targetModel = expectedModel ?? (task === undefined ? undefined : String(task.model));
      if (
        task === undefined ||
        (taskId !== undefined && String(task.id) !== taskId) ||
        (claimToken !== undefined && taskId === undefined) ||
        targetModel === undefined ||
        String(task.model) !== targetModel ||
        model !== targetModel ||
        (taskId === undefined
          ? task.status !== 'PENDING' || task.claim_token !== null
          : claimToken === undefined ||
            task.status !== 'RUNNING' ||
            String(task.claim_token) !== claimToken)
      ) {
        return 'STALE';
      }

      const updateRows = await executeInTransaction<Row[]>(
        em,
        `update issue_embedding_tasks t set status = 'SUCCEEDED',
           attempt_count = attempt_count + case when $4::uuid is null then 1 else 0 end,
           last_error = null, claim_token = null, claimed_by_process_execution_id = null,
           claimed_at = null, completed_at = now(), updated_at = now()
         from issues i
         where t.id = $1 and t.issue_id = i.id and i.publication_status = 'PUBLISHED'
           and t.input_hash = $2 and t.model = $3
           and (($4::uuid is null and t.status = 'PENDING' and t.claim_token is null)
             or ($4::uuid is not null and t.status = 'RUNNING' and t.claim_token = $4))
         returning t.id`,
        [task.id, inputHash, targetModel, claimToken ?? null],
      );
      if (updateRows.length !== 1) return 'STALE';

      await executeInTransaction<unknown>(
        em,
        `insert into issue_embeddings (id, issue_id, embedding, model, dimension, input_hash, input_version, created_at, updated_at)
         values ($1, $2, $3::vector, $4, 1536, $5, $6, now(), now())
         on conflict (issue_id) do update set embedding = excluded.embedding, model = excluded.model, dimension = excluded.dimension,
           input_hash = excluded.input_hash, input_version = excluded.input_version, updated_at = now()`,
        [
          generateUuidV7(),
          issueId,
          vector,
          model,
          inputHash,
          `${model}:1536:title+integrated_summary`,
        ],
      );
      await refreshEmbeddingPendingCounts(em);
      return 'SAVED';
    });
  }

  async markEmbeddingPending(
    runId: UuidV7,
    attempt: number,
    executionId: UuidV7,
    jobId: UuidV7,
    message?: string,
  ): Promise<void> {
    await this.entityManager.transactional(async (em) => {
      const taskRows = await executeInTransaction<Row[]>(
        em,
        `select t.id from issue_embedding_tasks t
         join issue_content_jobs j on j.id = t.issue_content_job_id
         join pipeline_runs r on r.id = t.pipeline_run_id
         join issues i on i.id = t.issue_id and i.publication_status = 'PUBLISHED'
         where r.id = $1 and r.attempt = $2 and r.execution_id = $3
           and r.status in ('RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED')
           and j.id = $4 and j.attempt = $2 and j.status = 'SUCCEEDED'
         for update`,
        [runId, attempt, executionId, jobId],
      );
      const task = taskRows[0];
      if (task === undefined) return;
      await executeInTransaction<unknown>(
        em,
        `update issue_embedding_tasks set status = 'PENDING', attempt_count = attempt_count + 1,
           last_error = $2, claim_token = null, claimed_by_process_execution_id = null,
           claimed_at = null, completed_at = null, updated_at = now()
         where id = $1 and status = 'PENDING'`,
        [task.id, message === undefined ? null : safeError(message)],
      );
      await refreshEmbeddingPendingCounts(em);
    });
  }

  async claimPendingEmbeddingTasks(
    limit: number,
    processExecutionId: UuidV7,
    claimToken: UuidV7,
  ): Promise<PipelineEmbeddingTask[]> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100;
    return this.entityManager.transactional(async (em) => {
      const rows = await executeInTransaction<Row[]>(
        em,
        `with candidates as (
           select t.id
           from issue_embedding_tasks t
           join issues i on i.id = t.issue_id and i.publication_status = 'PUBLISHED'
           left join issue_embeddings e on e.issue_id = t.issue_id
           where t.status = 'PENDING'
              or (t.status = 'SUCCEEDED' and (
                   e.id is null or e.input_hash <> t.input_hash or e.model <> t.model or e.dimension <> 1536
                 ))
           order by t.updated_at, t.id
           limit $1
           for update of t skip locked
         ), claimed as (
           update issue_embedding_tasks t
           set status = 'RUNNING', claim_token = $2, claimed_by_process_execution_id = $3,
               claimed_at = now(), attempt_count = attempt_count + 1, updated_at = now()
           from candidates c
           where t.id = c.id
             and exists (
               select 1 from issues i
               where i.id = t.issue_id and i.publication_status = 'PUBLISHED'
             )
           returning t.*
         )
         select c.id, c.issue_id, c.pipeline_run_id, c.issue_content_job_id, c.run_attempt,
                c.run_execution_id, c.input_hash, c.model, c.status, c.attempt_count, c.last_error,
                c.claim_token, c.claimed_by_process_execution_id, c.claimed_at,
                i.title, d.integrated_summary
         from claimed c
         join issues i on i.id = c.issue_id and i.publication_status = 'PUBLISHED'
         join issue_details d on d.issue_id = c.issue_id
         order by c.updated_at, c.id`,
        [safeLimit, claimToken, processExecutionId],
      );
      await refreshEmbeddingPendingCounts(em);
      return rows.map((row: Row) => this.toEmbeddingTask(row));
    });
  }

  async listPendingEmbeddingTasks(limit: number): Promise<PipelineEmbeddingTask[]> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100;
    const rows = await this.execute<Row[]>(
      `select t.id, t.issue_id, t.pipeline_run_id, t.issue_content_job_id, t.run_attempt,
              t.run_execution_id, t.input_hash, t.model, t.status, t.attempt_count, t.last_error,
              t.claim_token, t.claimed_by_process_execution_id, t.claimed_at,
              i.title, d.integrated_summary
       from issue_embedding_tasks t
       join issues i on i.id = t.issue_id
       join issue_details d on d.issue_id = t.issue_id
       left join issue_embeddings e on e.issue_id = t.issue_id
       where i.publication_status = 'PUBLISHED'
         and (t.status in ('PENDING', 'RUNNING')
          or e.id is null or e.input_hash <> t.input_hash or e.model <> t.model or e.dimension <> 1536)
       order by t.updated_at, t.id
       limit $1`,
      [safeLimit],
    );
    return rows.map((row: Row) => this.toEmbeddingTask(row));
  }

  async failEmbeddingTask(taskId: UuidV7, claimToken: UuidV7, message: string): Promise<boolean> {
    return this.entityManager.transactional(async (em) => {
      const rows = await executeInTransaction<Row[]>(
        em,
        `update issue_embedding_tasks t set status = 'PENDING', last_error = $3,
           claim_token = null, claimed_by_process_execution_id = null, claimed_at = null,
           completed_at = null, updated_at = now()
         from issues i
         where t.id = $1 and t.issue_id = i.id and i.publication_status = 'PUBLISHED'
           and t.status = 'RUNNING' and t.claim_token = $2
         returning t.id`,
        [taskId, claimToken, safeError(message)],
      );
      if (rows.length === 0) return false;
      await refreshEmbeddingPendingCounts(em);
      return true;
    });
  }

  async releaseEmbeddingClaim(taskId: UuidV7, claimToken: UuidV7): Promise<boolean> {
    return this.entityManager.transactional(async (em) => {
      const rows = await executeInTransaction<Row[]>(
        em,
        `update issue_embedding_tasks
         set status = 'PENDING', claim_token = null, claimed_by_process_execution_id = null,
             claimed_at = null, completed_at = null, updated_at = now()
         where id = $1 and status = 'RUNNING' and claim_token = $2
         returning id`,
        [taskId, claimToken],
      );
      if (rows.length === 0) return false;
      await refreshEmbeddingPendingCounts(em);
      return true;
    });
  }

  async releaseEmbeddingClaims(processExecutionId: UuidV7): Promise<number> {
    return this.entityManager.transactional(async (em) => {
      const rows = await executeInTransaction<Row[]>(
        em,
        `update issue_embedding_tasks
         set status = 'PENDING', claim_token = null, claimed_by_process_execution_id = null,
             claimed_at = null, completed_at = null, updated_at = now()
         where status = 'RUNNING' and claimed_by_process_execution_id = $1
         returning id`,
        [processExecutionId],
      );
      if (rows.length > 0) await refreshEmbeddingPendingCounts(em);
      return rows.length;
    });
  }

  async requeueEmbeddingClaims(deadProcessExecutionId: UuidV7): Promise<number> {
    return this.entityManager.transactional(async (em) => {
      const rows = await executeInTransaction<Row[]>(
        em,
        `update issue_embedding_tasks t set status = 'PENDING', claim_token = null,
           claimed_by_process_execution_id = null, claimed_at = null, updated_at = now()
         from issues i
         where t.issue_id = i.id and i.publication_status = 'PUBLISHED'
           and t.status = 'RUNNING' and t.claimed_by_process_execution_id = $1
         returning t.id`,
        [deadProcessExecutionId],
      );
      if (rows.length > 0) await refreshEmbeddingPendingCounts(em);
      return rows.length;
    });
  }

  private async readJobs(runId: string): Promise<PipelineJobRecord[]> {
    const rows = await this.execute<Row[]>(
      'select * from issue_content_jobs where pipeline_run_id = $1 order by created_at, id',
      [runId],
    );
    return rows.map((row: Row) => this.toJob(row));
  }

  private async readSnapshot(row: Row): Promise<PipelineRunSnapshot> {
    const [jobs, usageSummary, embeddingPendingCount] = await Promise.all([
      this.readJobs(String(row.id)),
      this.readUsageSummary(String(row.id)),
      this.readEmbeddingPendingCount(String(row.id)),
    ]);
    return this.toSnapshot(row, jobs, usageSummary, embeddingPendingCount);
  }

  private async readEmbeddingPendingCount(runId: string): Promise<number> {
    const row = (
      await this.execute<Row[]>(
        `select count(*)::int as count
         from issue_embedding_tasks t
         join issues i on i.id = t.issue_id and i.publication_status = 'PUBLISHED'
         left join issue_embeddings e on e.issue_id = t.issue_id
         where t.pipeline_run_id = $1
           and (t.status in ('PENDING', 'RUNNING')
             or e.id is null or e.input_hash <> t.input_hash or e.model <> t.model or e.dimension <> 1536)`,
        [runId],
      )
    )[0];
    return Number(row?.count ?? 0);
  }

  private async readUsageSummary(runId: string): Promise<PipelineUsageSummary> {
    const row = (
      await this.execute<Row[]>(
        `select count(*)::int as calls,
                count(*) filter (where status = 'SUCCEEDED')::int as succeeded_calls,
                count(*) filter (where status = 'FAILED')::int as failed_calls,
                count(*) filter (where status = 'UNKNOWN')::int as unknown_calls,
                coalesce(sum(input_tokens), 0)::bigint as input_tokens,
                coalesce(sum(output_tokens), 0)::bigint as output_tokens,
                sum(actual_cost) as actual_cost
         from ai_usage_records where pipeline_run_id = $1`,
        [runId],
      )
    )[0];
    return {
      calls: Number(row?.calls ?? 0),
      succeededCalls: Number(row?.succeeded_calls ?? 0),
      failedCalls: Number(row?.failed_calls ?? 0),
      unknownCalls: Number(row?.unknown_calls ?? 0),
      inputTokens: Number(row?.input_tokens ?? 0),
      outputTokens: Number(row?.output_tokens ?? 0),
      actualCost:
        row?.actual_cost === null || row?.actual_cost === undefined
          ? null
          : Number(row.actual_cost),
    };
  }

  private toSnapshot(
    row: Row,
    jobs: PipelineJobRecord[],
    usageSummary: PipelineUsageSummary,
    embeddingPendingCount = Number(row.embedding_pending_count ?? 0),
  ): PipelineRunSnapshot {
    const request = parseJson(row.request_json, { query: '', limits: {} });
    const candidateCounts = parseJson(row.candidate_counts, {
      discovered: 0,
      duplicate: 0,
      uncertain: 0,
      created: 0,
      skippedByLimit: 0,
    });
    const retryJobIds = parseJson(row.retry_job_ids, []);
    return {
      id: String(row.id) as UuidV7,
      idempotencyKey: String(row.idempotency_key),
      requestHash: String(row.request_hash),
      request: request as PipelineRunSnapshot['request'],
      status: String(row.status) as PipelineRunSnapshot['status'],
      attempt: Number(row.attempt),
      retryScope:
        row.retry_scope === 'DISCOVERY' || row.retry_scope === 'CONTENT'
          ? row.retry_scope
          : undefined,
      retryJobIds: Array.isArray(retryJobIds) ? retryJobIds.filter(isUuidV7) : [],
      executionId:
        row.execution_id === null || row.execution_id === undefined
          ? undefined
          : (String(row.execution_id) as UuidV7),
      currentStage:
        row.current_stage === null || row.current_stage === undefined
          ? undefined
          : (String(row.current_stage) as PipelineJobStage),
      candidateCounts: candidateCounts as PipelineRunSnapshot['candidateCounts'],
      jobs,
      lastError:
        row.last_error === null || row.last_error === undefined
          ? undefined
          : String(row.last_error),
      embeddingPendingCount,
      usageSummary,
      startedAt: toIso(row.started_at),
      finishedAt: toIso(row.finished_at),
      createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
      updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
    };
  }

  private toJob(row: Row): PipelineJobRecord {
    return {
      id: String(row.id) as UuidV7,
      runId: String(row.pipeline_run_id) as UuidV7,
      issueId: String(row.issue_id) as UuidV7,
      status: String(row.status) as PipelineJobRecord['status'],
      stage: String(row.stage) as PipelineJobStage,
      failureKind:
        row.failure_kind === null || row.failure_kind === undefined
          ? undefined
          : (String(row.failure_kind) as PipelineJobRecord['failureKind']),
      lastError:
        row.last_error === null || row.last_error === undefined
          ? undefined
          : String(row.last_error),
      attempt: Number(row.attempt),
    };
  }

  private toArticle(row: Row): DiscoveredArticle {
    return {
      id: String(row.id) as UuidV7,
      title: String(row.title),
      description: String(row.description ?? ''),
      sourceUrl: String(row.article_url),
      naverUrl:
        row.naver_url === null || row.naver_url === undefined ? undefined : String(row.naver_url),
      publisherName: String(row.publisher_name ?? 'unknown'),
      publishedAt: toIso(row.published_at),
    };
  }

  private toEmbeddingTask(row: Row): PipelineEmbeddingTask {
    return {
      id: String(row.id) as UuidV7,
      issueId: String(row.issue_id) as UuidV7,
      runId: String(row.pipeline_run_id) as UuidV7,
      jobId: String(row.issue_content_job_id) as UuidV7,
      runAttempt: Number(row.run_attempt),
      ...(row.run_execution_id === null || row.run_execution_id === undefined
        ? {}
        : { runExecutionId: String(row.run_execution_id) as UuidV7 }),
      ...(row.claim_token === null || row.claim_token === undefined
        ? {}
        : { claimToken: String(row.claim_token) as UuidV7 }),
      ...(row.claimed_by_process_execution_id === null ||
      row.claimed_by_process_execution_id === undefined
        ? {}
        : {
            claimedByProcessExecutionId: String(row.claimed_by_process_execution_id) as UuidV7,
          }),
      ...(row.claimed_at === null || row.claimed_at === undefined
        ? {}
        : { claimedAt: toIso(row.claimed_at) }),
      inputHash: String(row.input_hash),
      model: String(row.model),
      status: String(row.status) as PipelineEmbeddingTask['status'],
      attempts: Number(row.attempt_count),
      title: String(row.title),
      integratedSummary: String(row.integrated_summary),
      ...(row.last_error === null || row.last_error === undefined
        ? {}
        : { lastError: String(row.last_error) }),
    };
  }
}

async function refreshEmbeddingPendingCounts(em: EntityManager): Promise<void> {
  await executeInTransaction<unknown>(
    em,
    `update pipeline_runs r set embedding_pending_count = (
       select count(*)::int
       from issue_embedding_tasks t
       join issues i on i.id = t.issue_id and i.publication_status = 'PUBLISHED'
       left join issue_embeddings e on e.issue_id = t.issue_id
       where t.pipeline_run_id = r.id
         and (t.status in ('PENDING', 'RUNNING')
           or e.id is null or e.input_hash <> t.input_hash or e.model <> t.model or e.dimension <> 1536)
     ), updated_at = now()`,
  );
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value === 'object' && value !== null) return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function safeError(message: string): string {
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function emptyUsageSummary(): PipelineUsageSummary {
  return {
    calls: 0,
    succeededCalls: 0,
    failedCalls: 0,
    unknownCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    actualCost: null,
  };
}

function collectVerifiedEvidenceIds(
  content: GeneratedIssueContent,
  validation: SemanticValidationResult,
): Set<string> {
  const ids = new Set<string>();
  for (const group of validation.independentEvidenceGroups) {
    for (const articleId of group) ids.add(articleId);
  }
  for (const viewpoint of content.viewpoints ?? []) {
    for (const articleId of viewpoint.articleIds) ids.add(articleId);
  }
  for (const glossary of content.glossary) {
    for (const articleId of glossary.articleIds) ids.add(articleId);
  }
  for (const impact of content.impacts) {
    for (const articleId of impact.articleIds) ids.add(articleId);
  }
  return ids;
}

function validateSeedLineage(input: RegisterIssueInput): void {
  if (
    !Array.isArray(input.seedArticles) ||
    input.candidate === null ||
    typeof input.candidate !== 'object' ||
    input.candidate.candidate === null ||
    typeof input.candidate.candidate !== 'object'
  ) {
    throw new PipelineException(
      PipelineExceptionCode.InvalidInput,
      '이슈는 발견된 기사 근거와 함께 등록해야 합니다.',
    );
  }
  const seedIds = input.seedArticles.flatMap((article) =>
    article.id === undefined ? [] : [article.id],
  );
  const sourceIds = input.candidate.candidate.sourceArticleIds;
  if (
    !Array.isArray(sourceIds) ||
    seedIds.length === 0 ||
    sourceIds.length === 0 ||
    seedIds.some((id) => !isUuidV7(id)) ||
    sourceIds.some((id) => !isUuidV7(id)) ||
    new Set(seedIds).size !== seedIds.length ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => !seedIds.includes(id))
  ) {
    throw new PipelineException(
      PipelineExceptionCode.InvalidInput,
      '이슈는 발견된 기사 근거와 함께 등록해야 합니다.',
    );
  }
}
