import { Migration } from '@mikro-orm/migrations';

/**
 * Freezes the recommendation knobs used by a feed session. New application
 * code writes both values explicitly; database defaults keep an older binary
 * compatible during a rolling deployment.
 */
export class Migration20260915000004FeedAlgorithmSnapshot extends Migration {
  override up(): void {
    this.addSql(String.raw`
alter table feed_sessions
  add column if not exists candidate_budget integer,
  add column if not exists high_score_threshold numeric;

do $$
begin
  if exists (
    select 1
      from feed_sessions
     where status = 'ACTIVE'
       and expires_at > now()
       and (
         candidate_budget is null
         or candidate_budget < 10
         or candidate_budget > 500
         or high_score_threshold is null
         or high_score_threshold::text = 'NaN'
         or high_score_threshold < 0
         or high_score_threshold > 1
       )
  ) then
    raise exception 'Feed algorithm snapshot migration found an active session without a trustworthy snapshot';
  end if;

  update feed_sessions
     set candidate_budget = 100
   where candidate_budget is null
      or candidate_budget < 10
      or candidate_budget > 500;

  update feed_sessions
     set high_score_threshold = 0.7
   where high_score_threshold is null
      or high_score_threshold::text = 'NaN'
      or high_score_threshold < 0
      or high_score_threshold > 1;

  alter table feed_sessions
    alter column candidate_budget set default 100,
    alter column candidate_budget set not null,
    alter column high_score_threshold set default 0.7,
    alter column high_score_threshold set not null;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'feed_sessions'::regclass
       and conname = 'feed_sessions_candidate_budget_check'
  ) then
    alter table feed_sessions
      add constraint feed_sessions_candidate_budget_check
        check (candidate_budget between 10 and 500) not valid;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'feed_sessions'::regclass
       and conname = 'feed_sessions_high_score_threshold_check'
  ) then
    alter table feed_sessions
      add constraint feed_sessions_high_score_threshold_check
        check (high_score_threshold::text <> 'NaN' and high_score_threshold between 0 and 1) not valid;
  end if;
end
$$;

alter table feed_sessions
  validate constraint feed_sessions_candidate_budget_check;
alter table feed_sessions
  validate constraint feed_sessions_high_score_threshold_check;
    `);
  }

  override down(): void {
    throw new Error(
      'Feed algorithm snapshot migration is intentionally irreversible; review active sessions before reverting it.',
    );
  }
}

export default Migration20260915000004FeedAlgorithmSnapshot;
