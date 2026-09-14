import { Migration } from '@mikro-orm/migrations';

export class Migration202609130001Pipeline extends Migration {
  override up(): void {
    this.addSql(String.raw`
-- Pipeline v1.3. Apply explicitly with the project's migration runner.
-- No article body, prompt, generated input, or raw provider response is stored.

create extension if not exists vector;

create table if not exists issue_categories (
  code text primary key,
  display_name text not null,
  created_at timestamptz not null default now()
);

insert into issue_categories (code, display_name) values
  ('housing', '주거'), ('labor', '노동'), ('finance', '금융'), ('welfare', '복지'),
  ('education', '교육'), ('health', '건강'), ('climate', '기후'), ('security', '안보'),
  ('local', '지역'), ('politics', '정치')
on conflict (code) do nothing;

create table if not exists publishers (
  id uuid primary key,
  name text not null,
  homepage_url text,
  created_at timestamptz not null default now()
);

create table if not exists articles (
  id uuid primary key,
  publisher_id uuid references publishers(id) on delete set null,
  title text not null,
  description text not null default '',
  article_url text not null unique,
  naver_url text,
  publisher_name text not null default 'unknown',
  published_at timestamptz,
  source_status text not null default 'AVAILABLE' check (source_status in ('AVAILABLE', 'REMOVED', 'UNAVAILABLE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists issues (
  id uuid primary key,
  category_code text not null references issue_categories(code),
  title text not null,
  publication_status text not null check (publication_status in ('UNPUBLISHED', 'PUBLISHED', 'WITHDRAWN')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists issue_details (
  id uuid primary key,
  issue_id uuid not null unique references issues(id) on delete cascade,
  integrated_summary text not null,
  summary_lines jsonb not null,
  viewpoints jsonb,
  glossary jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists issue_impacts (
  id uuid primary key,
  issue_id uuid not null references issues(id) on delete cascade,
  target_type text not null check (target_type in ('AGE_GROUP')),
  target_value text not null check (target_value in ('AGE_19_34', 'AGE_35_49', 'AGE_50_64', 'AGE_65_PLUS')),
  description text not null,
  article_ids jsonb not null default '[]'::jsonb,
  unique (issue_id, target_type, target_value)
);

create table if not exists issue_articles (
  issue_id uuid not null references issues(id) on delete cascade,
  article_id uuid not null references articles(id) on delete restrict,
  primary key (issue_id, article_id)
);

create table if not exists issue_seed_articles (
  issue_id uuid not null references issues(id) on delete cascade,
  article_id uuid not null references articles(id) on delete restrict,
  primary key (issue_id, article_id)
);

create table if not exists pipeline_runs (
  id uuid primary key,
  idempotency_key text not null unique,
  request_hash text not null,
  request_json jsonb not null,
  status text not null check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED')),
  attempt integer not null default 1 check (attempt > 0),
  retry_scope text check (retry_scope is null or retry_scope in ('DISCOVERY', 'CONTENT')),
  retry_job_ids jsonb not null default '[]'::jsonb,
  execution_id uuid,
  current_stage text check (current_stage is null or current_stage in ('SEARCH', 'FETCH', 'GENERATE', 'VALIDATE')),
  candidate_counts jsonb not null default '{"discovered":0,"duplicate":0,"uncertain":0,"created":0,"skippedByLimit":0}'::jsonb,
  embedding_pending_count integer not null default 0 check (embedding_pending_count >= 0),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pipeline_runs
  add column if not exists retry_scope text check (retry_scope is null or retry_scope in ('DISCOVERY', 'CONTENT'));
alter table pipeline_runs
  add column if not exists retry_job_ids jsonb not null default '[]'::jsonb;

create unique index if not exists pipeline_runs_one_active_idx
  on pipeline_runs ((1)) where status in ('QUEUED', 'RUNNING');

create table if not exists issue_content_jobs (
  id uuid primary key,
  issue_id uuid not null references issues(id) on delete cascade,
  pipeline_run_id uuid references pipeline_runs(id) on delete set null,
  status text not null check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  stage text not null check (stage in ('SEARCH', 'FETCH', 'GENERATE', 'VALIDATE')),
  attempt integer not null default 1 check (attempt > 0),
  failure_kind text check (failure_kind is null or failure_kind in ('INTERRUPTED', 'INSUFFICIENT_EVIDENCE', 'INVALID_OUTPUT', 'SOURCE_UNAVAILABLE', 'UPSTREAM_ERROR')),
  validation_status text check (validation_status is null or validation_status in ('PASS', 'FAIL', 'UNCERTAIN')),
  validation_reason text,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists issue_content_jobs_one_active_idx
  on issue_content_jobs (issue_id) where status in ('QUEUED', 'RUNNING');
create index if not exists issue_content_jobs_run_idx on issue_content_jobs (pipeline_run_id, created_at, id);

create table if not exists ai_usage_records (
  id uuid primary key,
  pipeline_run_id uuid references pipeline_runs(id) on delete set null,
  issue_content_job_id uuid references issue_content_jobs(id) on delete set null,
  run_attempt integer not null check (run_attempt > 0),
  operation text not null check (operation in ('SEARCH', 'FETCH', 'EMBED', 'LLM')),
  purpose text not null,
  prompt_version text,
  prompt_hash text,
  provider text not null,
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  model text,
  provider_request_id text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  actual_cost numeric check (actual_cost is null or actual_cost >= 0),
  error_code text,
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
alter table ai_usage_records add column if not exists prompt_hash text;
create index if not exists ai_usage_records_run_idx on ai_usage_records (pipeline_run_id, run_attempt, started_at);

create table if not exists issue_embeddings (
  id uuid primary key,
  issue_id uuid not null unique references issues(id) on delete cascade,
  embedding vector(1536) not null,
  model text not null,
  dimension integer not null check (dimension = 1536),
  input_hash text not null,
  input_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
    `);
  }

  override down(): void {
    throw new Error(
      'Pipeline schema migration is intentionally irreversible; review data removal before reverting it.',
    );
  }
}

export default Migration202609130001Pipeline;
