import { Migration } from '@mikro-orm/migrations';

// Registered only by the standalone discovery entrypoint; existing API migrations are unchanged.
export class Migration20260920000000NewsDiscovery extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table news_discovery_runs (
        id uuid primary key,
        day date not null unique,
        owner uuid not null,
        status text not null check (status in ('RUNNING', 'FAILED', 'COMPLETED')),
        snapshot jsonb not null,
        error_code text,
        heartbeat_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        finished_at timestamptz
      );
      create unique index news_discovery_single_running on news_discovery_runs ((true)) where status = 'RUNNING';
      create table news_follow_up_tracks (
        issue_id uuid primary key references issues(id) on delete cascade,
        keywords jsonb not null check (jsonb_typeof(keywords) = 'array'),
        last_checked_at timestamptz not null,
        expires_at timestamptz not null,
        known_titles jsonb not null default '[]'::jsonb check (jsonb_typeof(known_titles) = 'array'),
        enabled boolean not null default true,
        check (expires_at > last_checked_at)
      );
      create index news_follow_up_tracks_expiry on news_follow_up_tracks (expires_at) where enabled;
    `);
  }
  override async down(): Promise<void> {
    this.addSql('drop table news_follow_up_tracks; drop table news_discovery_runs;');
  }
}
