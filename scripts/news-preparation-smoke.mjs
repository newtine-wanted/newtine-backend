/* global process, console */
import assert from 'node:assert/strict';
import { collectionOrm } from './news-collection.mjs';
import { NewsPipelinePreparation } from '../dist/apps/batch/src/preparation/preparation.service.js';
import {
  NewsTermSchema,
  NewsIssueSearchSchema,
} from '../dist/libs/core/src/news-pipeline/newsPipeline.entity.js';
import { IssueSchema } from '../dist/libs/core/src/issue/persistence/issue.persistence.entity.js';
import { executePostgresSql as sql } from '../dist/libs/core/src/common/database/postgresSql.js';
import { generateUuidV7 as uuid } from '../dist/libs/core/src/common/id/uuidV7.generator.js';
import { termKey } from '../dist/apps/batch/src/generation/generation.policy.js';
assert.equal(process.env.DB_HOST, '127.0.0.1');
assert.equal(process.env.DB_PORT, '55432');
assert.equal(process.env.DB_NAME, 'news_discovery_local');
const orm = await collectionOrm();
const rollback = new Error('ROLLBACK_FIXTURES');
try {
  try {
    await orm.em.fork().transactional(async (em) => {
      const id = uuid(),
        hidden = uuid(),
        term = `용어 ${uuid()}`,
        existing = `기존 ${uuid()}`,
        conflict = `충돌 ${uuid()}`,
        unpublished = `비공개 ${uuid()}`;
      const at = new Date();
      for (const [issueId, status, glossary] of [
        [
          id,
          'PUBLISHED',
          [
            { term, definition: '새 설명' },
            { term: existing, definition: '새 값' },
            { term: conflict, definition: 'A' },
            { term: conflict, definition: 'B' },
          ],
        ],
        [hidden, 'UNPUBLISHED', [{ term: unpublished, definition: '저장 금지' }]],
      ]) {
        await sql(
          em,
          "insert into issues(id,category_code,title,publication_status,published_at) values($1,'politics','초기화 검증',$2,$3)",
          [issueId, status, at],
        );
        await sql(
          em,
          "insert into issue_details(id,issue_id,integrated_summary,summary_lines,viewpoints,glossary) values($1,$2,'검증',$4::jsonb,'[]',$3::jsonb)",
          [
            uuid(),
            issueId,
            JSON.stringify(glossary),
            JSON.stringify(['요약 하나', '요약 둘', '요약 셋']),
          ],
        );
      }
      await em.insert(NewsTermSchema, {
        normalizedTerm: termKey(existing),
        term: existing,
        definition: '기존 값',
      });
      const before = await em.find(
        IssueSchema,
        { id: { $in: [id, hidden] } },
        { disableIdentityMap: true },
      );
      const service = new NewsPipelinePreparation(em);
      await service.terms();
      await service.terms();
      const terms = await em.find(
        NewsTermSchema,
        { normalizedTerm: { $in: [term, existing, conflict, unpublished].map(termKey) } },
        { disableIdentityMap: true },
      );
      assert.equal(terms.length, 2);
      assert.equal(terms.find((t) => t.normalizedTerm === termKey(existing)).definition, '기존 값');
      await service.search(at);
      await service.search(at);
      assert.ok(
        await em.findOne(NewsIssueSearchSchema, { issueId: id }, { disableIdentityMap: true }),
      );
      assert.equal(
        await em.findOne(NewsIssueSearchSchema, { issueId: hidden }, { disableIdentityMap: true }),
        null,
      );
      assert.deepEqual(
        await em.find(IssueSchema, { id: { $in: [id, hidden] } }, { disableIdentityMap: true }),
        before,
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'existing term preserved',
        'new term stored',
        'ambiguous/hidden excluded',
        'search copied',
        'repeatable',
        'source unchanged',
        'fixtures rolled back',
      ],
    }),
  );
} finally {
  await orm.close(true);
}
