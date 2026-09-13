import { EntityManager } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import {
  generateUuidV7,
  IssueException,
  IssueExceptionCode,
  type FeedBatchRecord,
  type FeedOwner,
  type FeedSessionRecord,
  type IssueArticleRecord,
  type IssueCandidateScope,
  type IssueGlossaryRecord,
  type IssueImpactRecord,
  type IssueQueryRepository,
  type IssueRecord,
  type IssueRelationRecord,
  type UserInteractionRecord,
  type UserRecommendationContext,
} from '@newtine/core';

type DbRow = Record<string, unknown>;

/**
 * PostgreSQL adapter for the v1.3 issue read model and the feed state tables.
 * The schema migration is intentionally kept separate; this adapter never enables
 * MikroORM schema synchronization or creates business tables on startup.
 */
@Injectable()
export class PostgresIssueQueryRepository implements IssueQueryRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async createFeedSession(owner: FeedOwner, now: Date): Promise<FeedSessionRecord> {
    const id = generateUuidV7();
    const session: FeedSessionRecord = {
      id,
      owner: { ...owner },
      algorithmVersion: 'issue-card-query-v1',
      nextBatchNo: 0,
      status: 'ACTIVE',
      createdAt: new Date(now),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      lastTopic: null,
      lastRepresentativeEntityId: null,
      topicRun: 0,
      entityRun: 0,
    };
    await this.execute(
      `INSERT INTO feed_sessions
        (id, user_id, guest_token_hash, algorithm_version, next_batch_no, status,
         created_at, expires_at, last_topic, last_representative_entity_id, topic_run, entity_run)
       VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?, ?, ?::uuid, ?, ?)`,
      [
        id,
        owner.userId,
        owner.userId === null ? owner.guestKey : null,
        session.algorithmVersion,
        session.nextBatchNo,
        session.status,
        session.createdAt,
        session.expiresAt,
        session.lastTopic,
        session.lastRepresentativeEntityId,
        session.topicRun,
        session.entityRun,
      ],
      'run',
    );
    return session;
  }

  async findFeedSession(
    id: string,
    owner: FeedOwner,
    _now: Date,
  ): Promise<FeedSessionRecord | null> {
    void _now;
    const ownerClause =
      owner.userId === null ? 'user_id IS NULL AND guest_token_hash = ?' : 'user_id = ?::uuid';
    const rows = await this.execute<DbRow>(
      `SELECT id::text, user_id::text, guest_token_hash, algorithm_version, next_batch_no, status,
              created_at, expires_at, last_topic, last_representative_entity_id::text,
              topic_run, entity_run
         FROM feed_sessions
        WHERE id = ?::uuid AND ${ownerClause}`,
      owner.userId === null ? [id, owner.guestKey] : [id, owner.userId],
      'get',
    );
    const row = rows[0];
    return row === undefined ? null : toSession(row, owner);
  }

  async findFeedBatch(sessionId: string, batchNo: number): Promise<FeedBatchRecord | null> {
    const rows = await this.execute<DbRow>(
      `SELECT feed_session_id::text, batch_no, continuation, created_at
         FROM feed_batches
        WHERE feed_session_id = ?::uuid AND batch_no = ?`,
      [sessionId, batchNo],
      'get',
    );
    const row = rows[0];
    return row === undefined ? null : await this.loadBatch(row);
  }

  async findFeedBatches(sessionId: string): Promise<FeedBatchRecord[]> {
    const rows = await this.execute<DbRow>(
      `SELECT feed_session_id::text, batch_no, continuation, created_at
         FROM feed_batches
        WHERE feed_session_id = ?::uuid
        ORDER BY batch_no`,
      [sessionId],
      'all',
    );
    return Promise.all(rows.map((row) => this.loadBatch(row)));
  }

  async saveFeedBatch(session: FeedSessionRecord, batch: FeedBatchRecord): Promise<void> {
    await this.entityManager.transactional(async (manager) => {
      const connection = manager.getConnection();
      const transaction = manager.getTransactionContext();
      if (transaction === undefined) {
        throw new Error('feed batch transaction context is unavailable');
      }
      const execute = <T extends DbRow = DbRow>(
        sql: string,
        params: unknown[],
        method: 'all' | 'get' | 'run',
      ): Promise<T[]> =>
        connection
          .execute<T>(sql, params, method, transaction)
          .then((result) => normalizeRows<T>(result, method));
      const sessionRows = await execute<DbRow>(
        `SELECT id, status, next_batch_no
           FROM feed_sessions
          WHERE id = ?::uuid
          FOR UPDATE`,
        [session.id],
        'get',
      );
      const currentSession = sessionRows[0];
      const existing = await execute<DbRow>(
        `SELECT 1 FROM feed_batches WHERE feed_session_id = ?::uuid AND batch_no = ?`,
        [batch.sessionId, batch.batchNo],
        'get',
      );
      if (existing[0] !== undefined) return;
      const latestRows = await execute<DbRow>(
        `SELECT continuation
           FROM feed_batches
          WHERE feed_session_id = ?::uuid
          ORDER BY batch_no DESC
          LIMIT 1`,
        [batch.sessionId],
        'get',
      );
      const latestContinuation = latestRows[0]?.continuation;
      const currentNextBatchNo = numberValue(currentSession?.next_batch_no);
      if (
        currentSession === undefined ||
        currentSession.status === 'COMPLETED' ||
        currentNextBatchNo !== batch.batchNo ||
        (latestContinuation !== undefined && latestContinuation !== 'CONTINUE')
      ) {
        throw new IssueException(
          IssueExceptionCode.FeedBatchConflict,
          '현재 탐색 상태에서는 새 묶음을 저장할 수 없습니다.',
        );
      }
      await execute(
        `INSERT INTO feed_batches
          (feed_session_id, batch_no, continuation, created_at)
         VALUES (?::uuid, ?, ?, ?)`,
        [batch.sessionId, batch.batchNo, batch.continuation, batch.createdAt],
        'run',
      );
      for (const item of batch.items) {
        await execute(
          `INSERT INTO feed_batch_items
            (feed_session_id, batch_no, position, issue_id, selection_type, reason_codes)
           VALUES (?::uuid, ?, ?, ?::uuid, ?, ?::jsonb)`,
          [
            batch.sessionId,
            batch.batchNo,
            item.position,
            item.issueId,
            item.selectionType,
            JSON.stringify(item.reasonCodes),
          ],
          'run',
        );
      }
      await execute(
        `UPDATE feed_sessions
            SET next_batch_no = ?, status = ?, last_topic = ?,
                last_representative_entity_id = ?::uuid, topic_run = ?, entity_run = ?
          WHERE id = ?::uuid`,
        [
          session.nextBatchNo,
          session.status,
          session.lastTopic,
          session.lastRepresentativeEntityId,
          session.topicRun,
          session.entityRun,
          session.id,
        ],
        'run',
      );
    });
  }

  async findCandidates(
    excludedIssueIds: ReadonlySet<string>,
    limit?: number,
    scope?: IssueCandidateScope,
  ): Promise<IssueRecord[]> {
    const candidateLimit = limit === undefined ? undefined : normalizeLimit(limit);
    if (candidateLimit === 0) return [];
    if (scope === undefined || candidateLimit === undefined) {
      const rows = await this.queryCandidateRows('', [], excludedIssueIds, candidateLimit);
      return rows.map((row) => toIssue(row));
    }

    const rows: DbRow[] = [];
    const seenIds = new Set(excludedIssueIds);
    let remainingRows = candidateLimit;
    for (const slice of buildCandidateSlices(scope)) {
      if (remainingRows === 0) break;
      const sliceLimit = Math.min(
        remainingRows,
        Math.max(1, Math.floor(candidateLimit * slice.weight)),
      );
      const sliceRows = await this.queryCandidateRows(
        slice.where,
        slice.params,
        seenIds,
        sliceLimit,
      );
      for (const row of sliceRows) {
        const issueId = stringValue(row.id);
        if (seenIds.has(issueId)) continue;
        seenIds.add(issueId);
        rows.push(row);
        remainingRows -= 1;
      }
    }
    if (remainingRows > 0) {
      const fillRows = await this.queryCandidateRows('', [], seenIds, remainingRows);
      for (const row of fillRows) {
        const issueId = stringValue(row.id);
        if (seenIds.has(issueId)) continue;
        seenIds.add(issueId);
        rows.push(row);
        remainingRows -= 1;
        if (remainingRows === 0) break;
      }
    }
    const unique = new Map<string, IssueRecord>();
    for (const row of rows) {
      const issue = toIssue(row);
      if (!unique.has(issue.id)) unique.set(issue.id, issue);
    }
    return [...unique.values()].sort(compareIssue).slice(0, candidateLimit);
  }

  async findIssue(id: string): Promise<IssueRecord | null> {
    const rows = await this.execute<DbRow>(issueSelect('i.id = ?::uuid'), [id], 'get');
    const row = rows[0];
    if (row === undefined) return null;
    const issue = toIssue(row);
    issue.articles = await this.loadArticles(issue.id);
    issue.impacts = await this.loadImpacts(issue.id);
    return issue;
  }

  async findIssuesByIds(ids: ReadonlySet<string>): Promise<IssueRecord[]> {
    const issueIds = [...ids];
    if (issueIds.length === 0) return [];
    const rows = await this.execute<DbRow>(
      `${issueSelect('i.id = ANY(?::uuid[])')}
       ORDER BY i.importance_score DESC NULLS LAST, i.freshness_score DESC NULLS LAST,
                i.event_at DESC NULLS LAST, i.id`,
      [issueIds],
      'all',
    );
    return rows.map((row) => toIssue(row));
  }

  async findUserContext(userId: string): Promise<UserRecommendationContext | null> {
    const rows = await this.execute<DbRow>(
      `SELECT u.id::text, u.age_group
         FROM users u
        WHERE u.id = ?::uuid
        LIMIT 1`,
      [userId],
      'get',
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      userId: stringValue(row.id),
      // Preference rows do not identify their onboarding source. Do not infer a
      // selected set from mutable weights until the onboarding contract supplies it.
      selectedCategoryCodes: [],
      selectedEntityIds: [],
      preferredRegionCodes: [],
      ageGroup: ageGroupValue(row.age_group),
    };
  }

  async findLatestInteractions(userId: string): Promise<UserInteractionRecord[]> {
    const rows = await this.execute<DbRow>(
      `SELECT DISTINCT ON (issue_id) id::text, user_id::text, issue_id::text, event_type, created_at
         FROM user_interaction_events
        WHERE user_id = ?::uuid
        ORDER BY issue_id, created_at DESC, id DESC`,
      [userId],
      'all',
    );
    return rows.map((row) => ({
      id: stringValue(row.id),
      userId: stringValue(row.user_id),
      issueId: stringValue(row.issue_id),
      eventType: eventTypeValue(row.event_type),
      createdAt: dateValue(row.created_at),
    }));
  }

  async findFollowUps(issueIds: ReadonlySet<string>): Promise<IssueRelationRecord[]> {
    const ids = [...issueIds];
    if (ids.length === 0) return [];
    const rows = await this.execute<DbRow>(
      `SELECT from_issue_id::text, to_issue_id::text, relation_type, verified_at
         FROM issue_relations
        WHERE relation_type = 'FOLLOW_UP'
          AND verified_at IS NOT NULL
          AND from_issue_id = ANY(?::uuid[])`,
      [ids],
      'all',
    );
    return rows.map((row) => ({
      fromIssueId: stringValue(row.from_issue_id),
      toIssueId: stringValue(row.to_issue_id),
      relationType: 'FOLLOW_UP',
      verifiedAt: dateValue(row.verified_at),
    }));
  }

  private async loadBatch(row: DbRow): Promise<FeedBatchRecord> {
    const sessionId = stringValue(row.feed_session_id);
    const batchNo = numberValue(row.batch_no);
    const itemRows = await this.execute<DbRow>(
      `SELECT issue_id::text, position, selection_type, reason_codes
         FROM feed_batch_items
        WHERE feed_session_id = ?::uuid AND batch_no = ?
        ORDER BY position`,
      [sessionId, batchNo],
      'all',
    );
    return {
      sessionId,
      batchNo,
      continuation: continuationValue(row.continuation),
      createdAt: dateValue(row.created_at),
      items: itemRows.map((item) => ({
        issueId: stringValue(item.issue_id),
        position: numberValue(item.position),
        selectionType: selectionTypeValue(item.selection_type),
        reasonCodes: stringArray(item.reason_codes),
      })),
    };
  }

  private async loadArticles(issueId: string): Promise<IssueArticleRecord[]> {
    const rows = await this.execute<DbRow>(
      `SELECT a.id::text, a.title, a.article_url, p.name AS publisher_name, a.published_at
         FROM issue_articles ia
         JOIN articles a ON a.id = ia.article_id
         JOIN publishers p ON p.id = a.publisher_id
        WHERE ia.issue_id = ?::uuid
        ORDER BY ia.sort_order NULLS LAST, a.id`,
      [issueId],
      'all',
    );
    return rows.map((row) => ({
      id: stringValue(row.id),
      title: stringValue(row.title),
      url: stringValue(row.article_url),
      publisherName: stringValue(row.publisher_name),
      publishedAt: nullableDate(row.published_at),
    }));
  }

  private async loadImpacts(issueId: string): Promise<IssueImpactRecord[]> {
    const rows = await this.execute<DbRow>(
      `SELECT target_type, target_value, description
         FROM issue_impacts
        WHERE issue_id = ?::uuid
        ORDER BY id`,
      [issueId],
      'all',
    );
    return rows
      .map((row): IssueImpactRecord | null => {
        const targetType = impactTypeValue(row.target_type);
        return targetType === null
          ? null
          : {
              targetType,
              targetValue: stringValue(row.target_value),
              description: stringValue(row.description),
              timing: null,
              action: null,
            };
      })
      .filter((impact): impact is IssueImpactRecord => impact !== null);
  }

  private async queryCandidateRows(
    extraWhere: string,
    extraParams: unknown[],
    excludedIssueIds: ReadonlySet<string>,
    limit?: number,
  ): Promise<DbRow[]> {
    const ids = [...excludedIssueIds];
    const exclusion = ids.length === 0 ? '' : ' AND NOT (i.id = ANY(?::uuid[]))';
    const params = ids.length === 0 ? [...extraParams] : [...extraParams, ids];
    let query = `${issueSelect(`${PUBLIC_ISSUE_WHERE}${extraWhere === '' ? '' : ` AND (${extraWhere})`}`)}${exclusion}
       ORDER BY i.importance_score DESC NULLS LAST, i.freshness_score DESC NULLS LAST,
                i.event_at DESC NULLS LAST, i.id`;
    if (limit !== undefined) {
      query += '\n       LIMIT ?';
      params.push(limit);
    }
    return this.execute<DbRow>(query, params, 'all');
  }

  private async execute<T extends DbRow = DbRow>(
    sql: string,
    params: unknown[],
    method: 'all' | 'get' | 'run',
  ): Promise<T[]> {
    const result = (await this.entityManager
      .getConnection()
      .execute<T>(sql, params, method)) as unknown;
    return normalizeRows<T>(result, method);
  }
}

function normalizeRows<T>(result: unknown, method: 'all' | 'get' | 'run'): T[] {
  if (method === 'get') {
    const row = Array.isArray(result) ? result[0] : result;
    return row === undefined || row === null ? [] : [row as T];
  }
  if (Array.isArray(result)) return result as T[];
  if (result === undefined || result === null) return [];
  return [result as T];
}

const PUBLIC_ISSUE_WHERE =
  "i.publication_status = 'PUBLISHED' AND d.integrated_summary IS NOT NULL AND jsonb_typeof(d.summary_lines) = 'array' AND jsonb_array_length(d.summary_lines) = 3";

interface CandidateSlice {
  where: string;
  params: unknown[];
  weight: number;
}

function buildCandidateSlices(scope: IssueCandidateScope): CandidateSlice[] {
  const slices: CandidateSlice[] = [];
  const personalized = matchCondition(scope);
  if (personalized.sql !== 'FALSE') {
    slices.push({ where: personalized.sql, params: personalized.params, weight: 0.3 });
  }

  const threshold = Math.min(1, Math.max(0, scope.highScoreThreshold));
  const major = {
    sql: '(i.importance_score >= ? AND i.importance_score <= 1) OR (i.freshness_score >= ? AND i.freshness_score <= 1)',
    params: [threshold, threshold],
  };
  slices.push({ where: major.sql, params: major.params, weight: 0.2 });

  if (scope.connectedIssueIds.length > 0) {
    slices.push({
      where: 'i.id = ANY(?::uuid[])',
      params: [scope.connectedIssueIds],
      weight: 0.15,
    });
  }

  const excludedCategories = uniqueStrings([
    ...scope.selectedCategoryCodes,
    ...scope.actedCategoryCodes,
  ]);
  if (excludedCategories.length > 0) {
    slices.push({
      where: 'i.category_code <> ALL(?::text[])',
      params: [excludedCategories],
      weight: 0.2,
    });
  }

  const mismatch = mismatchCondition(scope);
  if (personalized.sql !== 'FALSE' && mismatch.sql !== 'FALSE') {
    slices.push({
      where: `NOT (${personalized.sql}) AND (${mismatch.sql}) AND (${major.sql})`,
      params: [...personalized.params, ...mismatch.params, ...major.params],
      weight: 0.15,
    });
  }
  return slices;
}

function matchCondition(scope: IssueCandidateScope): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.selectedCategoryCodes.length > 0) {
    clauses.push('i.category_code = ANY(?::text[])');
    params.push(scope.selectedCategoryCodes);
  }
  if (scope.selectedEntityIds.length > 0) {
    clauses.push(
      'EXISTS (SELECT 1 FROM issue_entities ie WHERE ie.issue_id = i.id AND ie.entity_id = ANY(?::uuid[]))',
    );
    params.push(scope.selectedEntityIds);
  }
  if (scope.preferredRegionCodes.length > 0) {
    clauses.push(
      "EXISTS (SELECT 1 FROM issue_impacts im WHERE im.issue_id = i.id AND im.target_type = 'REGION' AND im.target_value = ANY(?::text[]))",
    );
    params.push(scope.preferredRegionCodes);
  }
  if (scope.ageGroup !== null) {
    clauses.push(
      "EXISTS (SELECT 1 FROM issue_impacts im WHERE im.issue_id = i.id AND im.target_type = 'AGE_GROUP' AND im.target_value = ?)",
    );
    params.push(scope.ageGroup);
  }
  return {
    sql: clauses.length === 0 ? 'FALSE' : clauses.join(' OR '),
    params,
  };
}

function mismatchCondition(scope: IssueCandidateScope): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.selectedCategoryCodes.length > 0) {
    clauses.push('i.category_code <> ALL(?::text[])');
    params.push(scope.selectedCategoryCodes);
  }
  if (scope.selectedEntityIds.length > 0) {
    clauses.push(
      'EXISTS (SELECT 1 FROM issue_entities ie WHERE ie.issue_id = i.id) AND NOT EXISTS (SELECT 1 FROM issue_entities ie WHERE ie.issue_id = i.id AND ie.entity_id = ANY(?::uuid[]))',
    );
    params.push(scope.selectedEntityIds);
  }
  if (scope.preferredRegionCodes.length > 0) {
    clauses.push(
      "EXISTS (SELECT 1 FROM issue_impacts im WHERE im.issue_id = i.id AND im.target_type = 'REGION') AND NOT EXISTS (SELECT 1 FROM issue_impacts im WHERE im.issue_id = i.id AND im.target_type = 'REGION' AND im.target_value = ANY(?::text[]))",
    );
    params.push(scope.preferredRegionCodes);
  }
  if (scope.ageGroup !== null) {
    clauses.push(
      "EXISTS (SELECT 1 FROM issue_impacts im WHERE im.issue_id = i.id AND im.target_type = 'AGE_GROUP') AND NOT EXISTS (SELECT 1 FROM issue_impacts im WHERE im.issue_id = i.id AND im.target_type = 'AGE_GROUP' AND im.target_value = ?)",
    );
    params.push(scope.ageGroup);
  }
  return {
    sql: clauses.length === 0 ? 'FALSE' : clauses.join(' OR '),
    params,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function compareIssue(left: IssueRecord, right: IssueRecord): number {
  const byImportance = clamp01(right.importanceScore) - clamp01(left.importanceScore);
  if (byImportance !== 0) return byImportance;
  const byFreshness = clamp01(right.freshnessScore) - clamp01(left.freshnessScore);
  if (byFreshness !== 0) return byFreshness;
  const leftEventAt = left.eventAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEventAt = right.eventAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (rightEventAt !== leftEventAt) return rightEventAt - leftEventAt;
  return left.id.localeCompare(right.id);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function issueSelect(where: string): string {
  return `SELECT i.id::text AS id, i.title, i.category_code, c.name AS category_name,
                 i.sub_category, NULL::text AS main_topic, NULL::text AS representative_entity_id,
                 i.event_at, i.publication_status, i.freshness_score, i.importance_score,
                 i.published_at, i.updated_at, d.integrated_summary, d.summary_lines,
                 d.viewpoints, d.glossary,
                 COALESCE((SELECT array_agg(DISTINCT ie.entity_id::text)
                             FROM issue_entities ie WHERE ie.issue_id = i.id), '{}') AS entity_ids,
                 COALESCE((SELECT array_agg(DISTINCT im.target_value)
                             FROM issue_impacts im WHERE im.issue_id = i.id AND im.target_type = 'REGION'), '{}') AS region_codes,
                 COALESCE((SELECT array_agg(DISTINCT im.target_value)
                             FROM issue_impacts im WHERE im.issue_id = i.id AND im.target_type = 'AGE_GROUP'), '{}') AS age_groups,
                 (SELECT count(DISTINCT ia.article_id)::int FROM issue_articles ia WHERE ia.issue_id = i.id) AS article_count
            FROM issues i
            JOIN issue_categories c ON c.code = i.category_code
            LEFT JOIN issue_details d ON d.issue_id = i.id
           WHERE ${where}`;
}

function toIssue(row: DbRow): IssueRecord {
  return {
    id: stringValue(row.id),
    title: stringValue(row.title),
    categoryCode: stringValue(row.category_code),
    categoryName: stringValue(row.category_name),
    subCategory: nullableString(row.sub_category),
    mainTopic: nullableString(row.main_topic),
    representativeEntityId: nullableString(row.representative_entity_id),
    entityIds: stringArray(row.entity_ids),
    regionCodes: stringArray(row.region_codes),
    ageGroups: stringArray(row.age_groups) as IssueRecord['ageGroups'],
    eventAt: nullableDate(row.event_at),
    publicationStatus: publicationStatusValue(row.publication_status),
    freshnessScore: numberValue(row.freshness_score),
    importanceScore: numberValue(row.importance_score),
    publishedAt: nullableDate(row.published_at),
    updatedAt: dateValue(row.updated_at),
    integratedSummary: nullableString(row.integrated_summary),
    summaryLines: stringArray(row.summary_lines),
    viewpoints: viewpointsValue(row.viewpoints),
    glossary: glossaryValue(row.glossary),
    articles: [],
    articleCount: numberValue(row.article_count),
    impacts: [],
  };
}

function toSession(row: DbRow, owner: FeedOwner): FeedSessionRecord {
  return {
    id: stringValue(row.id),
    owner: { ...owner },
    algorithmVersion: stringValue(row.algorithm_version),
    nextBatchNo: numberValue(row.next_batch_no),
    status: row.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
    createdAt: dateValue(row.created_at),
    expiresAt: dateValue(row.expires_at),
    lastTopic: nullableString(row.last_topic),
    lastRepresentativeEntityId: nullableString(row.last_representative_entity_id),
    topicRun: numberValue(row.topic_run),
    entityRun: numberValue(row.entity_run),
  };
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function nullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : dateValue(value);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed))
        return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return value.startsWith('{') && value.endsWith('}')
        ? value
            .slice(1, -1)
            .split(',')
            .filter(Boolean)
            .map((item) => item.replace(/^"|"$/g, ''))
        : [];
    }
  }
  return [];
}

function viewpointsValue(value: unknown): IssueRecord['viewpoints'] {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return viewpointsValue(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((item) => ({
    statement: stringValue(item.statement),
    articleIds: stringArray(item.article_ids ?? item.articleIds),
  }));
}

function glossaryValue(value: unknown): IssueGlossaryRecord[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    try {
      return glossaryValue(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    term: stringValue(item.term),
    definition: stringValue(item.definition),
    articleIds: stringArray(item.article_ids ?? item.articleIds),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ageGroupValue(value: unknown): UserRecommendationContext['ageGroup'] {
  return value === 'AGE_19_34' ||
    value === 'AGE_35_49' ||
    value === 'AGE_50_64' ||
    value === 'AGE_65_PLUS'
    ? value
    : null;
}

function eventTypeValue(value: unknown): UserInteractionRecord['eventType'] {
  return value === 'LIKE' || value === 'SKIP' || value === 'PASS' ? value : 'PASS';
}

function publicationStatusValue(value: unknown): IssueRecord['publicationStatus'] {
  return value === 'UNPUBLISHED' || value === 'PUBLISHED' || value === 'WITHDRAWN'
    ? value
    : 'UNPUBLISHED';
}

function impactTypeValue(value: unknown): IssueImpactRecord['targetType'] | null {
  return value === 'REGION' || value === 'AGE_GROUP' ? value : null;
}

function selectionTypeValue(value: unknown): FeedBatchRecord['items'][number]['selectionType'] {
  return value === 'MAJOR' ||
    value === 'CONNECTED' ||
    value === 'EXPLORATION' ||
    value === 'OPPOSITE'
    ? value
    : 'PERSONALIZED';
}

function continuationValue(value: unknown): FeedBatchRecord['continuation'] {
  return value === 'EXHAUSTED' || value === 'CONSTRAINT_LIMITED' || value === 'SEARCH_LIMITED'
    ? value
    : 'CONTINUE';
}
