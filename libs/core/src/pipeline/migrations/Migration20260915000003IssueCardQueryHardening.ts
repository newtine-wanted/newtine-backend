import { Migration } from '@mikro-orm/migrations';

/**
 * Closes the public issue-card read contract without mutating already-applied
 * migrations. Invalid producer rows stop the migration; the producer owns the
 * correction and no guessed content is written here.
 */
export class Migration20260915000003IssueCardQueryHardening extends Migration {
  override up(): void {
    this.addSql(String.raw`
create or replace function issue_card_summary_lines_valid(value jsonb)
returns boolean
language plpgsql
immutable
as $function$
declare
  line jsonb;
begin
  if value is null or jsonb_typeof(value) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(value) <> 3 then
    return false;
  end if;

  for line in
    select element
      from jsonb_array_elements(value) as element
  loop
    if jsonb_typeof(line) <> 'string' or length(btrim(line #>> '{}')) = 0 then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

do $$
begin
  if to_regclass('issue_details') is null or to_regclass('issues') is null then
    raise exception 'Issue card query hardening requires issue_details and issues tables';
  end if;

  if exists (
    select 1
      from issue_details
     where not issue_card_summary_lines_valid(summary_lines)
  ) then
    raise exception 'Issue card query hardening found invalid summary_lines; producer correction is required';
  end if;

  if exists (
    select 1
      from issues
     where freshness_score is null
        or freshness_score::text = 'NaN'
        or freshness_score < 0
        or freshness_score > 1
        or importance_score is null
        or importance_score::text = 'NaN'
        or importance_score < 0
        or importance_score > 1
  ) then
    raise exception 'Issue card query hardening found scores outside the closed [0,1] contract';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'issue_details'::regclass
       and conname = 'issue_details_summary_lines_contract_check'
  ) then
    alter table issue_details
      add constraint issue_details_summary_lines_contract_check
        check (issue_card_summary_lines_valid(summary_lines)) not valid;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'issues'::regclass
       and conname = 'issues_freshness_score_range_check'
  ) then
    alter table issues
      add constraint issues_freshness_score_range_check
        check (freshness_score::text <> 'NaN' and freshness_score between 0 and 1) not valid;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'issues'::regclass
       and conname = 'issues_importance_score_range_check'
  ) then
    alter table issues
      add constraint issues_importance_score_range_check
        check (importance_score::text <> 'NaN' and importance_score between 0 and 1) not valid;
  end if;
end
$$;

alter table issue_details
  validate constraint issue_details_summary_lines_contract_check;
alter table issues
  validate constraint issues_freshness_score_range_check;
alter table issues
  validate constraint issues_importance_score_range_check;
    `);
  }

  override down(): void {
    throw new Error(
      'Issue card query hardening migration is intentionally irreversible; review producer data before reverting it.',
    );
  }
}

export default Migration20260915000003IssueCardQueryHardening;
