import type { EntityManager } from '@mikro-orm/core';
import { generateUuidV7 } from '@newtine/core';
import { executePostgresSql } from '@newtine/core/common/database/postgresSql.js';
import { seoulDay } from './discovery.policy.js';
import type {
  DiscoveryConfig,
  DiscoveryRun,
  DiscoverySnapshot,
  DiscoveryStore,
  SearchQuery,
  TrackingIssue,
} from './discovery.types.js';

type RunRow = { id: string; owner: string; status: string; snapshot: DiscoverySnapshot };
export class DiscoveryRepository implements DiscoveryStore {
  constructor(
    private readonly em: EntityManager,
    private readonly entityTypes: string[],
  ) {}
  async claim(at: Date, config: DiscoveryConfig): Promise<DiscoveryRun> {
    const day = seoulDay(at);
    const owner = generateUuidV7();
    return this.em.transactional(async (em) => {
      // Serializes claims including different dates. No long-running transaction around external calls.
      await executePostgresSql(em, 'select pg_advisory_xact_lock(92020001)');
      const existing = await executePostgresSql<RunRow[]>(
        em,
        'select * from news_discovery_runs where day = $1',
        [day],
      );
      if (existing[0]?.status === 'COMPLETED') return { ...existing[0], day, completed: true };
      await executePostgresSql(
        em,
        `update news_discovery_runs set status = 'FAILED', error_code = 'LEASE_EXPIRED'
        where status = 'RUNNING' and heartbeat_at < now() - interval '5 minutes'`,
      );
      const active = await executePostgresSql<RunRow[]>(
        em,
        "select id from news_discovery_runs where status = 'RUNNING'",
      );
      if (active.length) throw new Error('DISCOVERY_ALREADY_RUNNING');
      const snapshot: DiscoverySnapshot = { at: at.toISOString(), config, results: [], usage: [] };
      const rows = await executePostgresSql<RunRow[]>(
        em,
        `insert into news_discovery_runs (id, day, owner, status, snapshot)
        values ($1, $2, $3, 'RUNNING', $4::jsonb)
        on conflict (day) do update set owner = excluded.owner, status = 'RUNNING', error_code = null,
          heartbeat_at = now(), finished_at = null returning *`,
        [generateUuidV7(), day, owner, JSON.stringify(snapshot)],
      );
      return { ...rows[0]!, day, completed: false };
    });
  }
  async catalog(since: string): Promise<SearchQuery[]> {
    const categories = await executePostgresSql<{ code: string; name: string }[]>(
      this.em,
      'select code, display_name as name from issue_categories order by display_order, code',
    );
    const regions = await executePostgresSql<{ code: string; name: string }[]>(
      this.em,
      'select code, name from regions order by display_order, code',
    );
    const entities = await executePostgresSql<{ id: string; name: string; type: string }[]>(
      this.em,
      'select id, name, type from entities where is_active = true and type = any($1::text[]) order by type, name, id',
      [this.entityTypes],
    );
    return [
      ...categories.flatMap((c) =>
        c.name.split('·').map((text) => ({ text, origins: [`TOPIC:${c.code}`], since })),
      ),
      ...regions.map((r) => ({ text: r.name, origins: [`REGION:${r.code}`], since })),
      ...entities.map((e) => ({ text: e.name, origins: [`${e.type}:${e.id}`], since })),
    ];
  }
  async tracks(at: string): Promise<TrackingIssue[]> {
    const rows = await executePostgresSql<
      {
        issue_id: string;
        title: string;
        keywords: string[];
        last_checked_at: Date;
        expires_at: Date;
        known_titles: string[];
      }[]
    >(
      this.em,
      `select t.*, i.title from news_follow_up_tracks t join issues i on i.id = t.issue_id
        where t.enabled and t.expires_at > $1 and t.last_checked_at < $1 and i.publication_status = 'PUBLISHED'
        order by t.issue_id`,
      [at],
    );
    return rows.map((r) => ({
      issueId: r.issue_id,
      title: r.title,
      keywords: r.keywords,
      lastCheckedAt: new Date(r.last_checked_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      knownTitles: r.known_titles,
    }));
  }
  async save(run: DiscoveryRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      `update news_discovery_runs set snapshot = $3::jsonb, heartbeat_at = now()
        where id = $1 and owner = $2 and status = 'RUNNING' returning id`,
      [run.id, run.owner, JSON.stringify(run.snapshot)],
    );
    if (!rows.length) throw new Error('DISCOVERY_LEASE_LOST');
  }
  async heartbeat(run: DiscoveryRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      "update news_discovery_runs set heartbeat_at = now() where id = $1 and owner = $2 and status = 'RUNNING' returning id",
      [run.id, run.owner],
    );
    if (!rows.length) throw new Error('DISCOVERY_LEASE_LOST');
  }
  async complete(run: DiscoveryRun): Promise<void> {
    await this.em.transactional(async (em) => {
      const rows = await executePostgresSql<{ id: string }[]>(
        em,
        `update news_discovery_runs set status = 'COMPLETED', snapshot = $3::jsonb, finished_at = now()
          where id = $1 and owner = $2 and status = 'RUNNING' returning id`,
        [run.id, run.owner, JSON.stringify(run.snapshot)],
      );
      if (!rows.length) throw new Error('DISCOVERY_LEASE_LOST');
      for (const track of run.snapshot.tracks ?? []) {
        const titles = [
          ...new Set([
            ...track.knownTitles,
            ...(run.snapshot.candidates ?? [])
              .filter((c) => c.parentIssueIds.includes(track.issueId))
              .map((c) => c.title),
          ]),
        ];
        await executePostgresSql(
          em,
          `update news_follow_up_tracks set last_checked_at = least($2::timestamptz, expires_at - interval '1 microsecond'), known_titles = $3::jsonb
          where issue_id = $1 and last_checked_at = $4::timestamptz`,
          [track.issueId, run.snapshot.at, JSON.stringify(titles), track.lastCheckedAt],
        );
      }
    });
    run.completed = true;
  }
  async fail(run: DiscoveryRun, reason: string): Promise<void> {
    await executePostgresSql(
      this.em,
      `update news_discovery_runs set status = 'FAILED', error_code = $3, finished_at = now()
      where id = $1 and owner = $2 and status = 'RUNNING'`,
      [run.id, run.owner, reason],
    );
  }
}
