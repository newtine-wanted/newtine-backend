import { Migration } from '@mikro-orm/migrations';

/**
 * Durable state for the on-demand diagnostic report worker and its report
 * scoped AI usage ledger.
 *
 * The down direction is intentionally blocked.  Reports contain user-owned
 * snapshots and generated results, so deleting the table must be an explicit
 * data-retention decision rather than an automatic migration rollback.
 */
export class Migration20260916000000DiagnosticReport extends Migration {
  override up(): void {
    this.addSql(String.raw`
create table if not exists weekly_reports (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null,
  input_snapshot jsonb not null,
  input_version integer not null default 1,
  input_captured_at timestamptz not null,
  input_hash text not null,
  candidates jsonb,
  content jsonb,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null,
  last_error_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  model text,
  prompt_version text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retryable boolean not null default false,
  constraint weekly_reports_status_check
    check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  constraint weekly_reports_period_check
    check (period_end = period_start + 7 and extract(isodow from period_start) = 1),
  constraint weekly_reports_attempt_check
    check (attempt_count between 0 and 5),
  constraint weekly_reports_result_check
    check ((status = 'SUCCEEDED') = (content is not null)),
  constraint weekly_reports_lease_check
    check ((status = 'RUNNING' and lease_token is not null
      and lease_expires_at is not null and heartbeat_at is not null)
      or (status <> 'RUNNING' and lease_token is null
      and lease_expires_at is null and heartbeat_at is null)),
  constraint weekly_reports_user_period_unique unique (user_id, period_start)
);

create index if not exists weekly_reports_claim_idx
  on weekly_reports (status, next_attempt_at, requested_at, id)
  where status = 'QUEUED';

create index if not exists weekly_reports_expired_lease_idx
  on weekly_reports (lease_expires_at, id)
  where status = 'RUNNING';

alter table ai_usage_records
  add column if not exists weekly_report_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'ai_usage_records'::regclass
       and conname = 'ai_usage_records_weekly_report_fk'
  ) then
    alter table ai_usage_records
      add constraint ai_usage_records_weekly_report_fk
      foreign key (weekly_report_id) references weekly_reports(id) on delete set null;
  end if;
end $$;

do $$
begin
  -- Existing pipeline rows may have both pipeline_run_id and
  -- issue_content_job_id.  Keep those rows valid; a report scoped usage row
  -- must be owned exclusively by weekly_report_id.
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'ai_usage_records'::regclass
       and conname = 'ai_usage_records_report_owner_exclusive_check'
  ) then
    alter table ai_usage_records
      add constraint ai_usage_records_report_owner_exclusive_check
      check (
        weekly_report_id is null
        or (pipeline_run_id is null and issue_content_job_id is null)
      );
  end if;
end $$;

create index if not exists ai_usage_records_weekly_report_idx
  on ai_usage_records (weekly_report_id, started_at, id)
  where weekly_report_id is not null;
    `);
  }

  override down(): void {
    throw new Error(
      'Diagnostic report migration is intentionally irreversible; review report snapshots and AI usage data before reverting it.',
    );
  }
}

export default Migration20260916000000DiagnosticReport;
