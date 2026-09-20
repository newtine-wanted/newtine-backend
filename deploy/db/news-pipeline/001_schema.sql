-- Apply after the application base schema (issues and issue_details).
-- Preserves existing pipeline rows, including historical validation modes.
begin;

create table if not exists news_discovery_runs (
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
create unique index if not exists news_discovery_single_running on news_discovery_runs ((true)) where status = 'RUNNING';
create table if not exists news_follow_up_tracks (
  issue_id uuid primary key references issues(id) on delete cascade,
  keywords jsonb not null check (jsonb_typeof(keywords) = 'array'),
  last_checked_at timestamptz not null,
  expires_at timestamptz not null,
  known_titles jsonb not null default '[]'::jsonb check (jsonb_typeof(known_titles) = 'array'),
  enabled boolean not null default true,
  check (expires_at > last_checked_at)
);
create index if not exists news_follow_up_tracks_expiry on news_follow_up_tracks (expires_at) where enabled;

create extension if not exists pg_trgm;
create table if not exists news_collection_runs (
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
create unique index if not exists news_collection_single_running on news_collection_runs ((true)) where status = 'RUNNING';

create table if not exists news_terms (
  normalized_term text primary key,
  term text not null check (length(trim(term)) > 0),
  definition text not null check (length(trim(definition)) > 0),
  created_at timestamptz not null default now()
);
create table if not exists news_generation_runs (
  id uuid primary key,
  collection_run_id uuid not null unique references news_collection_runs(id),
  owner uuid not null,
  status text not null check (status in ('RUNNING', 'FAILED', 'COMPLETED')),
  snapshot jsonb not null,
  error_code text,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists news_generation_single_running on news_generation_runs ((true)) where status = 'RUNNING';

create table if not exists news_validation_runs (
  id uuid primary key,
  generation_run_id uuid not null unique references news_generation_runs(id),
  owner uuid not null,
  status text not null check (status in ('RUNNING', 'FAILED', 'COMPLETED')),
  snapshot jsonb not null,
  error_code text,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists news_validation_single_running on news_validation_runs ((true)) where status = 'RUNNING';

alter table news_validation_runs add column if not exists validation_mode text not null default 'AI';
alter table news_validation_runs drop constraint if exists news_validation_runs_validation_mode_check;
alter table news_validation_runs add constraint news_validation_runs_validation_mode_check
  check (validation_mode in ('AI', 'RULES_ONLY', 'TONE'));
alter table news_validation_runs drop constraint if exists news_validation_runs_generation_run_id_key;
alter table news_validation_runs drop constraint if exists news_validation_source_mode_unique;
alter table news_validation_runs add constraint news_validation_source_mode_unique unique (generation_run_id, validation_mode);

commit;
