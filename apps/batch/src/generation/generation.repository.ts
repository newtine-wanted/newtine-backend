import { checkedRunStatus } from '@newtine/core/news-pipeline/newsPipeline.policy.js';
import type { EntityManager } from '@mikro-orm/core';
import { generateUuidV7 } from '@newtine/core';
import { executePostgresSql } from '@newtine/core/common/database/postgresSql.js';
import type { CollectionSnapshot } from '../collection/collection.types.js';
import { termKey } from './generation.policy.js';
import type {
  GenerationConfig,
  GenerationRun,
  GenerationSnapshot,
  Catalog,
  TermDefinition,
  GenerationStore,
} from './generation.types.js';

type RunRow = { id: string; owner: string; status: string; snapshot: GenerationSnapshot };
export class GenerationRepository implements GenerationStore {
  constructor(private readonly em: EntityManager) {}
  async claim(collectionRunId: string, at: Date, config: GenerationConfig): Promise<GenerationRun> {
    return this.em.transactional(async (em) => {
      await executePostgresSql(em, 'select pg_advisory_xact_lock(92020003)');
      const previous = await executePostgresSql<RunRow[]>(
        em,
        'select * from news_generation_runs where collection_run_id = $1',
        [collectionRunId],
      );
      if (previous[0]) checkedRunStatus(previous[0].status);
      if (previous[0]?.status === 'COMPLETED')
        return { ...previous[0], collectionRunId, completed: true };
      const sources = await executePostgresSql<{ snapshot: CollectionSnapshot }[]>(
        em,
        "select snapshot from news_collection_runs where id = $1 and status = 'COMPLETED'",
        [collectionRunId],
      );
      const candidates = sources[0]?.snapshot.results?.filter((r) => r.status === 'SELECTED');
      if (!Array.isArray(candidates)) throw new Error('COMPLETED_COLLECTION_REQUIRED');
      if (
        candidates.some(
          (r) =>
            !Array.isArray(r.selectedArticles) ||
            r.selectedArticles.length < 2 ||
            r.selectedArticles.length > 5,
        )
      )
        throw new Error('INVALID_SELECTED_ARTICLES');
      await executePostgresSql(
        em,
        "update news_generation_runs set status = 'FAILED', error_code = 'LEASE_EXPIRED' where status = 'RUNNING' and heartbeat_at < now() - interval '5 minutes'",
      );
      const active = await executePostgresSql<{ id: string }[]>(
        em,
        "select id from news_generation_runs where status = 'RUNNING'",
      );
      if (active.length) throw new Error('GENERATION_ALREADY_RUNNING');
      const snapshot: GenerationSnapshot = {
        at: at.toISOString(),
        config,
        results: candidates.map((source) => ({ source, articles: [], fetchFailures: [] })),
        usage: [],
      };
      const rows = await executePostgresSql<RunRow[]>(
        em,
        `insert into news_generation_runs (id, collection_run_id, owner, status, snapshot)
        values ($1, $2, $3, 'RUNNING', $4::jsonb)
        on conflict (collection_run_id) do update set owner = excluded.owner, status = 'RUNNING', error_code = null,
        heartbeat_at = now(), finished_at = null returning *`,
        [generateUuidV7(), collectionRunId, generateUuidV7(), JSON.stringify(snapshot)],
      );
      return { ...rows[0]!, collectionRunId, completed: false };
    });
  }
  async catalog(): Promise<Catalog> {
    const topics = await executePostgresSql<Catalog['topics']>(
      this.em,
      'select code, display_name as name from issue_categories order by display_order, code',
    );
    const regions = await executePostgresSql<Catalog['regions']>(
      this.em,
      'select code, name from regions order by display_order, code',
    );
    const entities = await executePostgresSql<Catalog['entities']>(
      this.em,
      "select id::text as code, name from entities where is_active = true and type in ('POLITICIAN', 'INSTITUTION', 'PARTY') order by name, id",
    );
    return { topics, regions, entities };
  }
  async terms(names: string[]): Promise<TermDefinition[]> {
    if (!names.length) return [];
    const rows = await executePostgresSql<{ term: string; definition: string }[]>(
      this.em,
      'select term, definition from news_terms where normalized_term = any($1::text[]) order by normalized_term',
      [names.map(termKey)],
    );
    return rows.map((r) => ({ ...r, source: 'DATABASE' }));
  }
  async save(run: GenerationRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      `update news_generation_runs set snapshot = $3::jsonb, heartbeat_at = now()
      where id = $1 and owner = $2 and status = 'RUNNING' returning id`,
      [run.id, run.owner, JSON.stringify(run.snapshot)],
    );
    if (!rows.length) throw new Error('GENERATION_LEASE_LOST');
  }
  async heartbeat(run: GenerationRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      "update news_generation_runs set heartbeat_at = now() where id = $1 and owner = $2 and status = 'RUNNING' returning id",
      [run.id, run.owner],
    );
    if (!rows.length) throw new Error('GENERATION_LEASE_LOST');
  }
  async complete(run: GenerationRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      `update news_generation_runs set status = 'COMPLETED', snapshot = $3::jsonb, finished_at = now()
      where id = $1 and owner = $2 and status = 'RUNNING' returning id`,
      [run.id, run.owner, JSON.stringify(run.snapshot)],
    );
    if (!rows.length) throw new Error('GENERATION_LEASE_LOST');
    run.completed = true;
  }
  async fail(run: GenerationRun, reason: string): Promise<void> {
    await executePostgresSql(
      this.em,
      "update news_generation_runs set status = 'FAILED', error_code = $3, finished_at = now() where id = $1 and owner = $2 and status = 'RUNNING'",
      [run.id, run.owner, reason],
    );
  }
}
