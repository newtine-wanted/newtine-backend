import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { afterAll, beforeAll, test } from '@jest/globals';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';

import { generateUuidV7, type UuidV7 } from '@newtine/core';
import { ReportException } from '@newtine/core/report/report.exception.js';
import { reportPeriod } from '@newtine/core/report/report.period.js';
import type {
  ReportCandidates,
  ReportContent,
  ReportIssue,
} from '@newtine/core/report/report.model.js';
import { MikroOrmReportRepository } from '@newtine/core/report/mikroOrmReport.repository.js';
import { ReportSchema } from '@newtine/core/report/persistence/report.persistence.entity.js';
import { executeReportSql } from '@newtine/core/report/report.sql.js';

// This suite intentionally requires a disposable database and an explicit
// opt-in.  Running without the URL is visible as skipped tests, never as a
// false claim that PostgreSQL concurrency was verified.
const database = process.env.REPORT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;
if (!database) {
  console.warn(
    'reportLifecycle.test.ts skipped: set REPORT_TEST_DATABASE_URL to run the real PostgreSQL lifecycle suite',
  );
}

type SqlRow = Record<string, unknown>;
type TestOrm = MikroORM;

let orm: TestOrm | undefined;

const fixedNow = new Date('2026-09-16T03:00:00.000Z');
const period = reportPeriod('2026-09-07');

interface Fixture {
  userId: UuidV7;
  issueIds: UuidV7[];
}

beforeAll(async () => {
  if (!database) return;
  const url = new URL(database);
  assert.equal(url.hostname, '127.0.0.1', 'refuse a non-local test database');
  assert.equal(url.pathname, '/report_test', 'refuse a non-disposable test database');
  orm = await MikroORM.init({
    driver: PostgreSqlDriver,
    host: url.hostname,
    port: Number(url.port),
    dbName: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    entities: [ReportSchema],
    allowGlobalContext: false,
  });
});

afterAll(async () => {
  await orm?.close(true);
  orm = undefined;
});

function requireOrm(): TestOrm {
  assert.ok(orm, 'REPORT_TEST_DATABASE_URL must initialize the test ORM');
  return orm;
}

async function sql<T extends SqlRow = SqlRow>(query: string, params: unknown[] = []): Promise<T[]> {
  let parameterIndex = 0;
  const postgresQuery = query.replace(/\?/g, () => `$${++parameterIndex}`);
  assert.equal(
    parameterIndex,
    params.length,
    `test SQL parameter count mismatch: found ${parameterIndex}, received ${params.length}`,
  );
  return executeReportSql<T[]>(requireOrm().em, postgresQuery, params);
}

async function createFixture(): Promise<Fixture> {
  const userId = generateUuidV7();
  await sql(
    `insert into users (id, email, onboarding_status, role, created_at)
     values (?, ?, 'COMPLETED', 'USER', ?)`,
    [userId, `report-lifecycle-${userId}@example.com`, fixedNow],
  );
  return { userId, issueIds: [] };
}

async function createIssue(
  fixture: Fixture,
  input: {
    categoryCode: string;
    title: string;
    publishedAt?: Date;
    importanceScore?: number;
    freshnessScore?: number;
    publicationStatus?: 'PUBLISHED' | 'WITHDRAWN';
  },
): Promise<UuidV7> {
  const issueId = generateUuidV7();
  const publishedAt = input.publishedAt ?? new Date('2026-09-09T01:00:00.000Z');
  const summary = `${input.title}의 현재 공개 요약입니다.`;
  await sql(
    `insert into issue_categories (code, display_name, display_order)
     values (?, ?, ?)
     on conflict (code) do update set display_name = excluded.display_name,
                                      display_order = excluded.display_order`,
    [input.categoryCode, input.categoryCode, categoryOrder(input.categoryCode)],
  );
  await sql(
    `insert into issues
       (id, category_code, title, publication_status, published_at,
        created_at, updated_at, event_at, sub_category, freshness_score, importance_score)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      issueId,
      input.categoryCode,
      input.title,
      input.publicationStatus ?? 'PUBLISHED',
      publishedAt,
      fixedNow,
      fixedNow,
      publishedAt,
      null,
      input.freshnessScore ?? 0.8,
      input.importanceScore ?? 0.8,
    ],
  );
  await sql(
    `insert into issue_details
       (id, issue_id, integrated_summary, summary_lines, viewpoints, glossary, generated_at, updated_at)
     values (?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?)`,
    [
      generateUuidV7(),
      issueId,
      summary,
      JSON.stringify([`${input.title} 사실`, `${input.title} 쟁점`, `${input.title} 영향`]),
      '[]',
      '[]',
      fixedNow,
      fixedNow,
    ],
  );
  fixture.issueIds.push(issueId);
  return issueId;
}

async function likeIssue(fixture: Fixture, issueId: UuidV7, createdAt: Date): Promise<void> {
  await sql(
    `insert into user_interaction_events
       (id, user_id, issue_id, session_id, event_type, dwell_time, previous_action, created_at)
     values (?, ?, ?, ?, 'LIKE', null, null, ?)`,
    [generateUuidV7(), fixture.userId, issueId, generateUuidV7(), createdAt],
  );
}

async function actOnIssue(fixture: Fixture, issueId: UuidV7, createdAt: Date): Promise<void> {
  await sql(
    `insert into user_interaction_events
       (id, user_id, issue_id, session_id, event_type, dwell_time, previous_action, created_at)
     values (?, ?, ?, ?, 'SKIP', null, null, ?)`,
    [generateUuidV7(), fixture.userId, issueId, generateUuidV7(), createdAt],
  );
}

async function insertValidEmbedding(issueId: UuidV7, vector: string, title: string): Promise<void> {
  const summary = `${title}의 현재 공개 요약입니다.`;
  const model = 'text-embedding-3-small';
  const inputHash = createHash('sha256').update(`${title}\n${summary}`).digest('hex');
  await sql(
    `insert into issue_embeddings
       (id, issue_id, embedding, model, dimension, input_hash, input_version, created_at, updated_at)
     values (?, ?, ?::vector, ?, 1536, ?, ?, ?, ?)`,
    [
      generateUuidV7(),
      issueId,
      vector,
      model,
      inputHash,
      `${model}:1536:title+integrated_summary`,
      fixedNow,
      fixedNow,
    ],
  );
}

function vectorAt(index: number): string {
  const values = new Array<number>(1_536).fill(0);
  values[index] = 1;
  return `[${values.join(',')}]`;
}

function categoryOrder(categoryCode: string): number {
  return (
    [
      'housing',
      'labor',
      'finance',
      'welfare',
      'education',
      'health',
      'climate',
      'security',
      'local',
      'politics',
    ].indexOf(categoryCode) + 1
  );
}

async function cleanup(fixture: Fixture): Promise<void> {
  await sql(`delete from user_interaction_events where user_id = ?`, [fixture.userId]);
  for (const issueId of fixture.issueIds) {
    await sql(`delete from issues where id = ?`, [issueId]);
  }
  await sql(`delete from users where id = ?`, [fixture.userId]);
}

function repository(): MikroOrmReportRepository {
  return new MikroOrmReportRepository(requireOrm().em.fork() as never);
}

function contentFor(
  inputIssues: readonly ReportIssue[],
  candidates: ReportCandidates,
  overrides: Partial<ReportContent> = {},
): ReportContent {
  return {
    schemaVersion: 1,
    analysisStatus: inputIssues.length < 5 ? 'INSUFFICIENT_DATA' : 'NO_CONNECTION',
    issueCount: inputIssues.length,
    minimumIssueCount: 5,
    categoryCounts: inputIssues.reduce<ReportContent['categoryCounts']>((all, issue) => {
      const existing = all.find((category) => category.categoryCode === issue.categoryCode);
      if (existing === undefined) {
        all.push({ categoryCode: issue.categoryCode, displayName: issue.categoryName, count: 1 });
      } else {
        existing.count += 1;
      }
      return all;
    }, []),
    connections: [],
    evidenceIssues: [],
    relatedIssues: candidates.related.map((candidate) => ({
      ...candidate,
      reason: '같은 주제의 공개 이슈로 함께 살펴볼 수 있습니다.',
    })),
    majorIssues: candidates.major,
    majorIssueCategoryCodes: candidates.majorCategoryCodes,
    majorIssuesStatus: candidates.major.length === 0 ? 'NO_CANDIDATES' : 'READY',
    recommendationsStatus: candidates.relatedUnavailable ? 'PARTIAL' : 'READY',
    recommendationCapturedAt: candidates.capturedAt,
    ...overrides,
  };
}

dbTest(
  'same member/week request converges to one snapshot and preserves ownership boundaries',
  async () => {
    const fixture = await createFixture();
    const other = await createFixture();
    try {
      const issueId = await createIssue(fixture, {
        categoryCode: 'housing',
        title: '기간 안의 관심 이슈',
      });
      await likeIssue(fixture, issueId, new Date('2026-09-08T03:00:00.000Z'));
      const [left, right] = await Promise.all([
        repository().request(fixture.userId, period, fixedNow),
        repository().request(fixture.userId, period, fixedNow),
      ]);
      assert.equal(left.id, right.id);
      assert.equal(left.input.issues.length, 1);
      assert.equal(left.input.categoryCounts[0]?.count, 1);
      assert.equal(
        left.input.categoryCounts.reduce((sum, item) => sum + item.count, 0),
        1,
      );
      assert.match(left.input.hash, /^[0-9a-f]{64}$/);
      assert.equal(await repository().findOwned(other.userId, left.id), null);
      assert.equal((await repository().listOwned(fixture.userId, '2026-09-01')).length, 1);
      assert.equal(await repository().findLatestSucceeded(fixture.userId), null);
    } finally {
      await cleanup(fixture);
      await cleanup(other);
    }
  },
  60_000,
);

dbTest(
  'report input selects the latest accepted action by accepted_order',
  async () => {
    const fixture = await createFixture();
    try {
      const issueId = await createIssue(fixture, {
        categoryCode: 'housing',
        title: '수용 순서 검증 이슈',
      });
      await sql(
        `insert into user_interaction_events
           (id, user_id, issue_id, session_id, event_type, dwell_time, previous_action,
            accepted_order, created_at)
         values (?, ?, ?, ?, 'SKIP', null, null, ?, ?)`,
        [
          generateUuidV7(),
          fixture.userId,
          issueId,
          generateUuidV7(),
          100,
          new Date('2026-09-08T05:00:00.000Z'),
        ],
      );
      await sql(
        `insert into user_interaction_events
           (id, user_id, issue_id, session_id, event_type, dwell_time, previous_action,
            accepted_order, created_at)
         values (?, ?, ?, ?, 'LIKE', null, null, ?, ?)`,
        [
          generateUuidV7(),
          fixture.userId,
          issueId,
          generateUuidV7(),
          200,
          new Date('2026-09-08T04:00:00.000Z'),
        ],
      );

      const report = await repository().request(fixture.userId, period, fixedNow);
      assert.deepEqual(
        report.input.issues.map((issue) => issue.issueId),
        [issueId],
      );
    } finally {
      await cleanup(fixture);
    }
  },
  60_000,
);

dbTest(
  'expired attempt three becomes manual retryable FAILED and attempt five cannot get stuck queued',
  async () => {
    const fixture = await createFixture();
    try {
      const report = await repository().request(fixture.userId, period, fixedNow);
      const attemptThreeToken = generateUuidV7();
      await sql(
        `update weekly_reports
            set status = 'RUNNING', attempt_count = 3, lease_token = ?,
                lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
          where id = ?`,
        [
          attemptThreeToken,
          new Date(fixedNow.getTime() - 1_000),
          new Date(fixedNow.getTime() - 2_000),
          new Date(fixedNow.getTime() - 61_000),
          report.id,
        ],
      );
      const usageId = generateUuidV7();
      await sql(
        `insert into ai_usage_records
           (id, weekly_report_id, pipeline_run_id, issue_content_job_id, run_attempt,
            operation, purpose, provider, status, model, started_at, created_at)
         values (?, ?, null, null, 3, 'LLM', 'report-analysis', 'openai', 'RUNNING', ?, ?, ?)`,
        [usageId, report.id, 'gpt-test', fixedNow, fixedNow],
      );
      assert.equal(await repository().claim(fixedNow, 180_000), null);
      const recovered = await repository().findOwned(fixture.userId, report.id);
      assert.equal(recovered?.status, 'FAILED');
      assert.equal(recovered?.attempt, 3);
      assert.equal(recovered?.retryable, true);
      const usage = await sql(`select status, error_code from ai_usage_records where id = ?`, [
        usageId,
      ]);
      assert.equal(usage[0]?.status, 'UNKNOWN');
      assert.equal(usage[0]?.error_code, 'LEASE_EXPIRED');

      await sql(`update weekly_reports set updated_at = ? where id = ?`, [
        new Date(fixedNow.getTime() - 61_000),
        report.id,
      ]);
      const retry4 = await repository().retry(fixture.userId, report.id, fixedNow);
      assert.equal(retry4.status, 'QUEUED');
      const claim4 = await repository().claim(fixedNow, 180_000);
      assert.ok(claim4);
      assert.equal(claim4.attempt, 4);
      assert.equal(await repository().fail(claim4, 'provider_timeout', true, fixedNow), true);
      await sql(`update weekly_reports set updated_at = ? where id = ?`, [
        new Date(fixedNow.getTime() - 61_000),
        report.id,
      ]);
      assert.equal(
        (await repository().retry(fixture.userId, report.id, fixedNow)).status,
        'QUEUED',
      );
      const claim5 = await repository().claim(fixedNow, 180_000);
      assert.ok(claim5);
      assert.equal(claim5.attempt, 5);
      await sql(`update weekly_reports set lease_expires_at = ?, heartbeat_at = ? where id = ?`, [
        new Date(fixedNow.getTime() - 1_000),
        new Date(fixedNow.getTime() - 2_000),
        report.id,
      ]);
      assert.equal(await repository().claim(fixedNow, 180_000), null);
      const final = await repository().findOwned(fixture.userId, report.id);
      assert.equal(final?.status, 'FAILED');
      assert.equal(final?.attempt, 5);
      assert.equal(final?.retryable, false);
    } finally {
      await cleanup(fixture);
    }
  },
  60_000,
);

dbTest(
  'lease fencing rejects stale completion and deleted members cannot resurrect a result',
  async () => {
    const fixture = await createFixture();
    try {
      const report = await repository().request(fixture.userId, period, fixedNow);
      const first = await repository().claim(fixedNow, 100);
      assert.ok(first);
      await sql(`update weekly_reports set lease_expires_at = ?, heartbeat_at = ? where id = ?`, [
        new Date(fixedNow.getTime() - 1),
        new Date(fixedNow.getTime() - 2),
        report.id,
      ]);
      const second = await repository().claim(new Date(fixedNow.getTime() + 1), 180_000);
      assert.ok(second);
      assert.equal(second.attempt, 2);
      const candidates = await repository().captureCandidates(second, fixedNow);
      const content = contentFor(second.input.issues, candidates);
      assert.equal(await repository().complete(first, content, fixedNow), false);
      assert.equal(await repository().complete(second, content, fixedNow), true);
      assert.equal((await repository().findLatestSucceeded(fixture.userId))?.id, report.id);
    } finally {
      await cleanup(fixture);
    }

    const deleted = await createFixture();
    const report = await repository().request(deleted.userId, period, fixedNow);
    const claim = await repository().claim(fixedNow, 180_000);
    assert.ok(claim);
    await sql(`delete from users where id = ?`, [deleted.userId]);
    const emptyCandidates: ReportCandidates = {
      capturedAt: fixedNow.toISOString(),
      related: [],
      major: [],
      majorCategoryCodes: [],
      relatedUnavailable: true,
    };
    const content = contentFor([], emptyCandidates);
    assert.equal(await repository().complete(claim, content, fixedNow), false);
    assert.equal(
      await sql(`select id from weekly_reports where id = ?`, [report.id]).then(
        (rows) => rows.length,
      ),
      0,
    );
    await cleanup(deleted);
  },
  60_000,
);

dbTest(
  'candidate snapshot uses valid shared vectors, excludes acted/self rows, and round-robins tied major categories',
  async () => {
    const fixture = await createFixture();
    try {
      const categorySuffix = fixture.userId.replaceAll('-', '').slice(0, 10);
      const housingCategory = `report_${categorySuffix}_a`;
      const laborCategory = `report_${categorySuffix}_b`;
      const sourceHousing = await createIssue(fixture, {
        categoryCode: housingCategory,
        title: '주거 관심 이슈',
      });
      const sourceLabor = await createIssue(fixture, {
        categoryCode: laborCategory,
        title: '일자리 관심 이슈',
      });
      await likeIssue(fixture, sourceHousing, new Date('2026-09-08T01:00:00.000Z'));
      await likeIssue(fixture, sourceLabor, new Date('2026-09-08T02:00:00.000Z'));
      await insertValidEmbedding(sourceHousing, vectorAt(2), '주거 관심 이슈');
      await insertValidEmbedding(sourceLabor, vectorAt(2), '일자리 관심 이슈');

      const relatedIds: UuidV7[] = [];
      for (let index = 0; index < 5; index += 1) {
        const related = await createIssue(fixture, {
          categoryCode: index % 2 === 0 ? housingCategory : laborCategory,
          title: `연결 후보 ${index}`,
          importanceScore: 0.4,
          freshnessScore: 0.4,
        });
        relatedIds.push(related);
        await insertValidEmbedding(related, vectorAt(2), `연결 후보 ${index}`);
      }
      const majorHousing = await createIssue(fixture, {
        categoryCode: housingCategory,
        title: '주거 주요 이슈',
        importanceScore: 0.95,
        freshnessScore: 0.4,
      });
      const majorLabor = await createIssue(fixture, {
        categoryCode: laborCategory,
        title: '일자리 주요 이슈',
        importanceScore: 0.4,
        freshnessScore: 0.95,
      });
      await insertValidEmbedding(majorHousing, vectorAt(3), '주거 주요 이슈');
      await insertValidEmbedding(majorLabor, vectorAt(3), '일자리 주요 이슈');

      const acted = await createIssue(fixture, {
        categoryCode: housingCategory,
        title: '이미 행동한 후보',
      });
      await insertValidEmbedding(acted, vectorAt(2), '이미 행동한 후보');
      await actOnIssue(fixture, acted, new Date('2026-09-08T04:00:00.000Z'));
      const invalidHash = await createIssue(fixture, {
        categoryCode: housingCategory,
        title: '해시가 틀린 후보',
        importanceScore: 0.4,
        freshnessScore: 0.4,
      });
      await sql(
        `insert into issue_embeddings
           (id, issue_id, embedding, model, dimension, input_hash, input_version, created_at, updated_at)
         values (?, ?, ?::vector, 'text-embedding-3-small', 1536, 'invalid',
                 'text-embedding-3-small:1536:title+integrated_summary', ?, ?)`,
        [generateUuidV7(), invalidHash, vectorAt(2), fixedNow, fixedNow],
      );
      const outsidePeriod = await createIssue(fixture, {
        categoryCode: housingCategory,
        title: '기간 밖 후보',
        publishedAt: new Date('2026-09-15T01:00:00.000Z'),
        importanceScore: 1,
        freshnessScore: 1,
      });
      await insertValidEmbedding(outsidePeriod, vectorAt(3), '기간 밖 후보');

      const repo = repository();
      const report = await repo.request(fixture.userId, period, fixedNow);
      assert.equal(report.input.issues.length, 2);
      assert.deepEqual(
        report.input.categoryCounts.map((category) => category.categoryCode),
        [housingCategory, laborCategory],
      );
      const claim = await repo.claim(fixedNow, 180_000);
      assert.ok(claim);
      const candidates = await repo.captureCandidates(claim, fixedNow);
      assert.equal(candidates.relatedUnavailable, false);
      assert.equal(candidates.related.length, 5);
      assert.equal(candidates.majorCategoryCodes.join(','), `${housingCategory},${laborCategory}`);
      assert.equal(candidates.major.length, 2);
      assert.deepEqual(
        new Set(candidates.major.map((issue) => issue.issueId)),
        new Set([majorHousing, majorLabor]),
      );
      assert.equal(candidates.major[0]?.categoryCode, housingCategory);
      assert.equal(candidates.major[1]?.categoryCode, laborCategory);
      assert.equal(
        candidates.related.some((issue) => issue.issueId === sourceHousing),
        false,
      );
      assert.equal(
        candidates.related.some((issue) => issue.issueId === sourceLabor),
        false,
      );
      assert.equal(
        candidates.related.some((issue) => issue.issueId === acted),
        false,
      );
      assert.equal(
        candidates.related.some((issue) => issue.issueId === invalidHash),
        false,
      );
      assert.equal(
        candidates.major.some((issue) => issue.issueId === outsidePeriod),
        false,
      );
      assert.deepEqual(await repo.captureCandidates(claim, fixedNow), candidates);

      await sql(`update issues set publication_status = 'WITHDRAWN' where id = ?`, [majorHousing]);
      const visibility = await repo.visibility(fixture.userId, [
        majorHousing,
        majorLabor,
        sourceHousing,
      ]);
      assert.equal(visibility.publicIssueIds.includes(majorHousing), false);
      assert.equal(visibility.publicIssueIds.includes(majorLabor), true);
      assert.equal(
        await repo.complete(claim, contentFor(report.input.issues, candidates), fixedNow),
        true,
        'withdrawn optional recommendation must not prevent a valid source analysis from succeeding',
      );
      assert.equal(visibility.actedIssueIds.includes(sourceHousing), true);
    } finally {
      await cleanup(fixture);
    }
  },
  60_000,
);

dbTest(
  'expired claims reject every claim-bound write before the next claim recovers them',
  async () => {
    const fixture = await createFixture();
    try {
      const report = await repository().request(fixture.userId, period, fixedNow);
      const claim = await repository().claim(fixedNow, 180_000);
      assert.ok(claim);
      await sql(`update weekly_reports set lease_expires_at = ?, heartbeat_at = ? where id = ?`, [
        new Date(fixedNow.getTime() - 1),
        new Date(fixedNow.getTime() - 2),
        report.id,
      ]);

      await assert.rejects(
        () => repository().captureCandidates(claim, fixedNow),
        (error: unknown) => error instanceof ReportException && error.code === 'STALE_CLAIM',
      );
      assert.equal(await repository().heartbeat(claim, fixedNow, 180_000), false);

      const emptyCandidates: ReportCandidates = {
        capturedAt: fixedNow.toISOString(),
        related: [],
        major: [],
        majorCategoryCodes: [],
        relatedUnavailable: true,
      };
      assert.equal(
        await repository().complete(
          claim,
          contentFor(claim.input.issues, emptyCandidates),
          fixedNow,
        ),
        false,
      );
      assert.equal(await repository().fail(claim, 'provider_timeout', true, fixedNow), false);

      const unchanged = await repository().findOwned(fixture.userId, report.id);
      assert.equal(unchanged?.status, 'RUNNING');
      assert.equal(unchanged?.attempt, 1);
      assert.equal(unchanged?.content, null);

      const recovered = await repository().claim(fixedNow, 180_000);
      assert.ok(recovered);
      assert.equal(recovered.attempt, 2);
    } finally {
      await cleanup(fixture);
    }
  },
  60_000,
);

dbTest(
  'completion rejects a withdrawn input issue before atomically publishing content',
  async () => {
    const fixture = await createFixture();
    try {
      const issueId = await createIssue(fixture, {
        categoryCode: 'housing',
        title: '철회될 관심 이슈',
      });
      await likeIssue(fixture, issueId, new Date('2026-09-08T01:00:00.000Z'));
      const repo = repository();
      const report = await repo.request(fixture.userId, period, fixedNow);
      const claim = await repo.claim(fixedNow, 180_000);
      assert.ok(claim);
      const candidates = await repo.captureCandidates(claim, fixedNow);
      await sql(`update issues set publication_status = 'WITHDRAWN' where id = ?`, [issueId]);
      await assert.rejects(
        () => repo.complete(claim, contentFor(report.input.issues, candidates), fixedNow),
        (error: unknown) => error instanceof ReportException && error.code === 'SOURCE_UNAVAILABLE',
      );
      const stored = await repo.findOwned(fixture.userId, report.id);
      assert.equal(stored?.status, 'RUNNING');
      assert.equal(stored?.content, null);
    } finally {
      await cleanup(fixture);
    }
  },
  60_000,
);
