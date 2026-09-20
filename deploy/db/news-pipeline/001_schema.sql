-- Existing application tables AND their production data are already present.
-- Add only pipeline-owned tables/indexes; never initialize or rewrite application data.
-- Defines the final pipeline schema; existing tables/data are never recreated.
-- Apply with psql -X -v ON_ERROR_STOP=1 -f this-file.sql.
begin;

create table if not exists news_discovery_runs (
  id uuid primary key,
  day date not null unique,
  owner uuid not null,
  status text not null,
  snapshot jsonb not null,
  error_code text,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists news_discovery_single_running on news_discovery_runs ((true)) where status = 'RUNNING';
create table if not exists news_follow_up_tracks (
  issue_id uuid primary key references issues(id) on delete cascade,
  keywords jsonb not null,
  last_checked_at timestamptz not null,
  expires_at timestamptz not null,
  known_titles jsonb not null default '[]'::jsonb,
  enabled boolean not null default true
);
create index if not exists news_follow_up_tracks_expiry on news_follow_up_tracks (expires_at) where enabled;

create extension if not exists pg_trgm;
-- Pipeline-owned search copy; the application issues table stays unchanged.
create table if not exists news_issue_search (
  issue_id uuid primary key,
  title text not null,
  published_at timestamptz not null
);
create index if not exists news_issue_search_title_trgm
  on news_issue_search using gist (title gist_trgm_ops);
create table if not exists news_collection_runs (
  id uuid primary key,
  discovery_run_id uuid not null unique references news_discovery_runs(id),
  owner uuid not null,
  status text not null,
  snapshot jsonb not null,
  error_code text,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists news_collection_single_running on news_collection_runs ((true)) where status = 'RUNNING';

create table if not exists news_terms (
  normalized_term text primary key,
  term text not null,
  definition text not null,
  created_at timestamptz not null default now()
);
create table if not exists news_generation_runs (
  id uuid primary key,
  collection_run_id uuid not null unique references news_collection_runs(id),
  owner uuid not null,
  status text not null,
  snapshot jsonb not null,
  error_code text,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists news_generation_single_running on news_generation_runs ((true)) where status = 'RUNNING';

create table if not exists news_validation_runs (
  id uuid primary key,
  generation_run_id uuid not null references news_generation_runs(id),
  validation_mode text not null,
  constraint news_validation_source_mode_unique unique (generation_run_id, validation_mode),
  owner uuid not null,
  status text not null,
  snapshot jsonb not null,
  error_code text,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists news_validation_single_running on news_validation_runs ((true)) where status = 'RUNNING';

commit;
