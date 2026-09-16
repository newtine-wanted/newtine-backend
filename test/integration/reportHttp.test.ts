import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { MikroORM } from '@mikro-orm/postgresql';
import { eligibleReportPeriod } from '@newtine/core/report/report.period.js';
import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

// This suite intentionally requires a disposable DB and an explicit opt-in.
const database = process.env.REPORT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;
dbTest(
  'report HTTP uses real JWT ownership, strict request validation and 202/200 replay',
  async () => {
    const url = new URL(database!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/report_test', 'refuse a non-disposable database');
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DB_HOST: url.hostname,
      DB_PORT: url.port,
      DB_NAME: 'report_test',
      DB_USER: url.username,
      DB_PASSWORD: decodeURIComponent(url.password),
      JWT_SECRET: 'report-http-disposable-test-secret-at-least-32-bytes',
      JWT_ISSUER: 'newtine-api',
      JWT_AUDIENCE: 'newtine-client',
      AUTH_COOKIE_SECURE: 'false',
    });
    await import('@nestjs/common');
    // HTTP tests must load ttsc output: Jest's lightweight TS transform does
    // not execute Nestia's request/response code generation.
    const builtModuleUrl = new URL('../../dist/apps/api/src/api.module.js', import.meta.url).href;
    const { ApiModule } = (await import(builtModuleUrl)) as { ApiModule: new () => object };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    const app = module.createNestApplication();
    let userId: string | undefined, otherId: string | undefined;
    const orm = app.get(MikroORM);
    const sql = orm.em.getConnection();
    try {
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const signup = async () => {
        const r = await fetch(`${base}/auth/signup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: `report-${generateUuidV7()}@example.com`,
            password: 'report-http-test-passphrase',
          }),
        });
        assert.equal(r.status, 201);
        return (await r.json()) as { accessToken: string; user: { id: string } };
      };
      const owner = await signup();
      const other = await signup();
      // Obtain IDs from the signed JWT's verified signup result for fixture cleanup only.
      userId = JSON.parse(Buffer.from(owner.accessToken.split('.')[1]!, 'base64url').toString())
        .sub as string;
      otherId = JSON.parse(Buffer.from(other.accessToken.split('.')[1]!, 'base64url').toString())
        .sub as string;
      const period = eligibleReportPeriod(new Date());
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${owner.accessToken}`,
      };
      assert.equal((await fetch(`${base}/me/reports`)).status, 401);
      const bad = await fetch(`${base}/me/reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ periodStart: period.start, userId: otherId }),
      });
      assert.equal(bad.status, 400);
      assert.match(bad.headers.get('content-type') ?? '', /application\/problem\+json/);
      const accepted = await fetch(`${base}/me/reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ periodStart: period.start }),
      });
      assert.equal(accepted.status, 202);
      assert.match(accepted.headers.get('cache-control') ?? '', /private, no-store/);
      const queued = (await accepted.json()) as { reportId: string; status: string };
      assert.equal(queued.status, 'QUEUED');
      assert.equal(accepted.headers.get('location'), `/me/reports/${queued.reportId}`);
      const replay = await fetch(`${base}/me/reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ periodStart: period.start }),
      });
      assert.equal(replay.status, 202);
      assert.equal(((await replay.json()) as { reportId: string }).reportId, queued.reportId);
      const foreignHeaders = { authorization: `Bearer ${other.accessToken}` };
      for (const suffix of ['', '/retry']) {
        const r = await fetch(`${base}/me/reports/${queued.reportId}${suffix}`, {
          method: suffix ? 'POST' : 'GET',
          headers: foreignHeaders,
        });
        assert.equal(r.status, 404);
      }
      const pending = await fetch(`${base}/me/reports/${queued.reportId}`, { headers });
      const pendingBody = (await pending.json()) as Record<string, unknown>;
      assert.equal(pendingBody.content, null);
      for (const secret of ['input', 'userId', 'leaseToken', 'attempt', 'candidates'])
        assert.equal(secret in pendingBody, false);
      const minimal = {
        schemaVersion: 1,
        analysisStatus: 'INSUFFICIENT_DATA',
        issueCount: 0,
        minimumIssueCount: 5,
        categoryCounts: [],
        connections: [],
        evidenceIssues: [],
        relatedIssues: [],
        majorIssues: [],
        majorIssueCategoryCodes: [],
        majorIssuesStatus: 'NO_INTEREST',
        recommendationsStatus: 'READY',
        recommendationCapturedAt: new Date().toISOString(),
      };
      await sql.execute(
        "update weekly_reports set status='SUCCEEDED', content=?::jsonb, completed_at=now() where id=?",
        [JSON.stringify(minimal), queued.reportId],
      );
      const successReplay = await fetch(`${base}/me/reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ periodStart: period.start }),
      });
      assert.equal(successReplay.status, 200);
      const retrySuccess = await fetch(`${base}/me/reports/${queued.reportId}/retry`, {
        method: 'POST',
        headers,
      });
      assert.equal(retrySuccess.status, 409);
      const list = await fetch(`${base}/me/reports`, { headers });
      const listed = (await list.json()) as {
        periods: unknown[];
        latestSucceeded: { reportId: string };
      };
      assert.equal(listed.periods.length, 4);
      assert.equal(listed.latestSucceeded.reportId, queued.reportId);
    } finally {
      for (const id of [userId, otherId])
        if (id) await sql.execute('delete from users where id=?', [id]);
      await app.close();
    }
  },
  60_000,
);
