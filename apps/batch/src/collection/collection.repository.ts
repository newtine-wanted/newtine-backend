import type { EntityManager } from '@mikro-orm/core';
import { generateUuidV7 } from '@newtine/core';
import { executePostgresSql } from '@newtine/core/common/database/postgresSql.js';
import type { DiscoverySnapshot } from '../discovery/discovery.types.js';
import type {
  CollectionConfig,
  CollectionRun,
  CollectionSnapshot,
  CollectionStore,
  SimilarIssue,
} from './collection.types.js';

type RunRow = { id: string; owner: string; status: string; snapshot: CollectionSnapshot };
export class CollectionRepository implements CollectionStore {
  constructor(private readonly em: EntityManager) {}
  private async synchronizeSearch(em: EntityManager, at: string): Promise<void> {
    // A single INSERT SELECT captures a consistent published-issue search snapshot.
    await executePostgresSql(em, 'delete from news_issue_search');
    await executePostgresSql(
      em,
      `insert into news_issue_search (issue_id, title, published_at)
      select id, title, published_at from issues
      where publication_status = 'PUBLISHED'
        and published_at >= $1::timestamptz - interval '7 days'
        and published_at <= $1::timestamptz`,
      [at],
    );
  }
  async refreshSearchIndex(at: string): Promise<void> {
    await this.em.transactional(async (em) => {
      await executePostgresSql(em, 'select pg_advisory_xact_lock(92020002)');
      await this.synchronizeSearch(em, at);
    });
  }
  async claim(discoveryRunId: string, at: Date, config: CollectionConfig): Promise<CollectionRun> {
    return this.em.transactional(async (em) => {
      await executePostgresSql(em, 'select pg_advisory_xact_lock(92020002)');
      const previous = await executePostgresSql<RunRow[]>(
        em,
        'select * from news_collection_runs where discovery_run_id = $1',
        [discoveryRunId],
      );
      if (previous[0]?.status === 'COMPLETED')
        return { ...previous[0], discoveryRunId, completed: true };
      const sources = await executePostgresSql<{ snapshot: DiscoverySnapshot }[]>(
        em,
        "select snapshot from news_discovery_runs where id = $1 and status = 'COMPLETED'",
        [discoveryRunId],
      );
      const candidates = sources[0]?.snapshot.candidates;
      if (!Array.isArray(candidates)) throw new Error('COMPLETED_DISCOVERY_REQUIRED');
      await executePostgresSql(
        em,
        "update news_collection_runs set status = 'FAILED', error_code = 'LEASE_EXPIRED' where status = 'RUNNING' and heartbeat_at < now() - interval '5 minutes'",
      );
      const active = await executePostgresSql<{ id: string }[]>(
        em,
        "select id from news_collection_runs where status = 'RUNNING'",
      );
      if (active.length) throw new Error('COLLECTION_ALREADY_RUNNING');
      const snapshot: CollectionSnapshot = {
        at: at.toISOString(),
        config,
        results: candidates.map((candidate) => ({ candidate })),
        usage: [],
      };
      const rows = await executePostgresSql<RunRow[]>(
        em,
        `insert into news_collection_runs (id, discovery_run_id, owner, status, snapshot)
        values ($1, $2, $3, 'RUNNING', $4::jsonb)
        on conflict (discovery_run_id) do update set owner = excluded.owner, status = 'RUNNING', error_code = null,
        heartbeat_at = now(), finished_at = null returning *`,
        [generateUuidV7(), discoveryRunId, generateUuidV7(), JSON.stringify(snapshot)],
      );
      await this.synchronizeSearch(em, rows[0]!.snapshot.at);
      return { ...rows[0]!, discoveryRunId, completed: false };
    });
  }
  async similar(title: string, at: string): Promise<SimilarIssue[]> {
    return executePostgresSql<SimilarIssue[]>(
      this.em,
      `select issue_id as id, title, similarity(title, $1) as similarity from news_issue_search
      where published_at >= $2::timestamptz - interval '7 days'
        and published_at <= $2::timestamptz
      order by title <-> $1, published_at desc, issue_id limit 10`,
      [title, at],
    );
  }
  async save(run: CollectionRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      `update news_collection_runs set snapshot = $3::jsonb, heartbeat_at = now()
      where id = $1 and owner = $2 and status = 'RUNNING' returning id`,
      [run.id, run.owner, JSON.stringify(run.snapshot)],
    );
    if (!rows.length) throw new Error('COLLECTION_LEASE_LOST');
  }
  async heartbeat(run: CollectionRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      "update news_collection_runs set heartbeat_at = now() where id = $1 and owner = $2 and status = 'RUNNING' returning id",
      [run.id, run.owner],
    );
    if (!rows.length) throw new Error('COLLECTION_LEASE_LOST');
  }
  async complete(run: CollectionRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      `update news_collection_runs set status = 'COMPLETED', snapshot = $3::jsonb, finished_at = now()
      where id = $1 and owner = $2 and status = 'RUNNING' returning id`,
      [run.id, run.owner, JSON.stringify(run.snapshot)],
    );
    if (!rows.length) throw new Error('COLLECTION_LEASE_LOST');
    run.completed = true;
  }
  async fail(run: CollectionRun, reason: string): Promise<void> {
    await executePostgresSql(
      this.em,
      "update news_collection_runs set status = 'FAILED', error_code = $3, finished_at = now() where id = $1 and owner = $2 and status = 'RUNNING'",
      [run.id, run.owner, reason],
    );
  }
}
