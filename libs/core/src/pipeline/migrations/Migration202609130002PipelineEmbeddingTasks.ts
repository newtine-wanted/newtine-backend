import { Migration } from '@mikro-orm/migrations';

export class Migration202609130002PipelineEmbeddingTasks extends Migration {
  override up(): void {
    this.addSql(String.raw`
-- Durable, privacy-safe embedding repair work. The task stores only the
-- published issue fields needed to reconstruct the embedding input.
create table if not exists issue_embedding_tasks (
  id uuid primary key,
  issue_id uuid not null unique references issues(id) on delete cascade,
  pipeline_run_id uuid not null references pipeline_runs(id) on delete cascade,
  issue_content_job_id uuid not null references issue_content_jobs(id) on delete cascade,
  run_attempt integer not null check (run_attempt > 0),
  run_execution_id uuid,
  input_hash text not null,
  model text not null,
  status text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  claim_token uuid,
  claimed_by_process_execution_id uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint issue_embedding_tasks_claim_check check (
    (status = 'RUNNING') = (
      claim_token is not null
      and claimed_by_process_execution_id is not null
      and claimed_at is not null
    )
  )
);

alter table issue_embedding_tasks add column if not exists run_execution_id uuid;
alter table issue_embedding_tasks add column if not exists claim_token uuid;
alter table issue_embedding_tasks add column if not exists claimed_by_process_execution_id uuid;
alter table issue_embedding_tasks add column if not exists claimed_at timestamptz;

do $$
declare
  constraint_row record;
begin
  -- A previously applied draft used a PENDING/SUCCEEDED-only status check.
  -- Remove that stale check before adding the RUNNING-aware constraint so this
  -- migration is safe for both fresh and already-created task tables.
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'issue_embedding_tasks'::regclass
      and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%status%'
      and lower(pg_get_constraintdef(oid)) not like '%running%'
  loop
    execute format(
      'alter table issue_embedding_tasks drop constraint %I',
      constraint_row.conname
    );
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'issue_embedding_tasks_status_check'
      and conrelid = 'issue_embedding_tasks'::regclass
  ) then
    alter table issue_embedding_tasks
      add constraint issue_embedding_tasks_status_check
      check (status in ('PENDING', 'RUNNING', 'SUCCEEDED'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'issue_embedding_tasks_claim_check'
      and conrelid = 'issue_embedding_tasks'::regclass
  ) then
    alter table issue_embedding_tasks
      add constraint issue_embedding_tasks_claim_check check (
        (status = 'RUNNING') = (
          claim_token is not null
          and claimed_by_process_execution_id is not null
          and claimed_at is not null
        )
      );
  end if;
end $$;

create index if not exists issue_embedding_tasks_pending_idx
  on issue_embedding_tasks (status, updated_at, id);

create index if not exists issue_embedding_tasks_claim_owner_idx
  on issue_embedding_tasks (status, claimed_by_process_execution_id)
  where status = 'RUNNING';
    `);
  }

  override down(): void {
    throw new Error(
      'Pipeline embedding task migration is intentionally irreversible; review data removal before reverting it.',
    );
  }
}

export default Migration202609130002PipelineEmbeddingTasks;
