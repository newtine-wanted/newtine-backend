import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { MikroORM } from '@mikro-orm/postgresql';
import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import { ReportSchema } from '@newtine/core/report/persistence/report.persistence.entity.js';
import { MikroOrmReportRepository } from '@newtine/core/report/mikroOrmReport.repository.js';
import { MikroOrmAiUsageRepository } from '@newtine/core/usage/mikroOrmAiUsage.repository.js';
import { executeReportSql } from '@newtine/core/report/report.sql.js';
import { reportPeriod } from '@newtine/core/report/report.period.js';
import { ReportException } from '@newtine/core/report/report.exception.js';
const database = process.env.REPORT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;
dbTest(
  'usage ledger preserves unknown cost, reconciles late results and survives member deletion',
  async () => {
    const url = new URL(database!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/report_test');
    const orm = await MikroORM.init({
      host: url.hostname,
      port: Number(url.port),
      dbName: 'report_test',
      user: url.username,
      password: url.password,
      entities: [ReportSchema],
    });
    const em = orm.em.fork();
    const repo = new MikroOrmReportRepository(em);
    const ledger = new MikroOrmAiUsageRepository(em);
    const userId = generateUuidV7();
    const now = new Date('2026-09-16T01:00:00Z');
    let usageId: string | undefined;
    let unfinishedId: string | undefined;
    try {
      await executeReportSql(
        em,
        `insert into users(id,email,onboarding_status,role,created_at) values($1,$2,'COMPLETED','USER',$3)`,
        [userId, `ledger-${userId}@example.com`, now],
      );
      const report = await repo.request(userId, reportPeriod('2026-09-07'), now);
      const claim = await repo.claim(now, 180000);
      assert.equal(claim?.id, report.id);
      const start = {
        userId,
        reportId: report.id,
        attempt: 1,
        leaseToken: claim!.leaseToken,
        purpose: 'report_generation',
        model: 'test-model',
        promptVersion: 'test@1',
        promptHash: 'test-hash',
        startedAt: now,
      };
      const id = await ledger.beginReport(start);
      usageId = id;
      await ledger.finish(id, { status: 'UNKNOWN', finishedAt: now });
      let rows = await executeReportSql<Record<string, unknown>[]>(
        em,
        'select * from ai_usage_records where id=$1',
        [id],
      );
      assert.equal(rows[0]?.actual_cost, null);
      assert.equal(rows[0]?.input_tokens, null);
      await ledger.finish(id, {
        status: 'SUCCEEDED',
        inputTokens: 12,
        outputTokens: 7,
        finishedAt: now,
      });
      await ledger.finish(id, { status: 'UNKNOWN', finishedAt: now });
      unfinishedId = await ledger.beginReport(start);
      assert.ok(claim);
      await repo.fail(claim, 'TEST_TERMINAL', false, now);
      assert.equal(await repo.claim(new Date(now.getTime() + 181000), 180000), null);
      const recovered = await executeReportSql<Record<string, unknown>[]>(
        em,
        'select status from ai_usage_records where id=$1',
        [unfinishedId],
      );
      assert.equal(recovered[0]?.status, 'UNKNOWN');
      await executeReportSql(em, 'delete from users where id=$1', [userId]);
      rows = await executeReportSql<Record<string, unknown>[]>(
        em,
        'select * from ai_usage_records where id=$1',
        [id],
      );
      assert.equal(rows[0]?.status, 'SUCCEEDED');
      assert.equal(rows[0]?.input_tokens, 12);
      assert.equal(rows[0]?.weekly_report_id, null);
      await assert.rejects(
        () => ledger.beginReport(start),
        (e: unknown) => e instanceof ReportException && e.code === 'STALE_CLAIM',
      );
    } finally {
      await executeReportSql(em, 'delete from users where id=$1', [userId]);
      if (unfinishedId)
        await executeReportSql(em, 'delete from ai_usage_records where id=$1', [unfinishedId]);
      if (usageId)
        await executeReportSql(em, 'delete from ai_usage_records where id=$1', [usageId]);
      await orm.close(true);
    }
  },
  60000,
);
