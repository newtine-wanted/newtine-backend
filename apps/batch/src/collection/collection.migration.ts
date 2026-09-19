import { Migration } from '@mikro-orm/migrations';

// Registered by the standalone collection CLI only.
export class Migration20260920000100NewsCollection extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create extension if not exists pg_trgm;
      create index news_collection_published_title_trgm on issues using gist (title gist_trgm_ops)
        where publication_status = 'PUBLISHED';
      create table news_collection_runs (
        id uuid primary key,
        discovery_run_id uuid not null unique references news_discovery_runs(id),
        owner uuid not null,
        status text not null check (status in ('RUNNING', 'FAILED', 'COMPLETED')),
        snapshot jsonb not null,
        error_code text,
        heartbeat_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        finished_at timestamptz
      );
      create unique index news_collection_single_running on news_collection_runs ((true)) where status = 'RUNNING';
    `);
  }
  override async down(): Promise<void> {
    this.addSql(
      'drop table news_collection_runs; drop index news_collection_published_title_trgm;',
    );
    // Keep the potentially shared pg_trgm extension.
  }
}
