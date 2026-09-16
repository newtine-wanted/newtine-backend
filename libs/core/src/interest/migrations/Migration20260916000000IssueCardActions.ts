import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the idempotent action ordering, contribution ledger, and detail-view
 * accumulator used by the issue-card action API. Existing interaction history
 * is deliberately fail-closed: it has no safe way to infer the old preference
 * contribution, so a non-empty table requires an explicit data transition.
 */
export class Migration20260916000000IssueCardActions extends Migration {
  override up(): void {
    this.addSql(String.raw`
do $$
begin
  if exists (select 1 from user_interaction_events) then
    raise exception 'Issue card actions migration requires an explicit transition for existing interaction history';
  end if;
end
$$;

create sequence if not exists user_interaction_events_accepted_order_seq;
alter table user_interaction_events
  add column if not exists accepted_order bigint;
alter sequence user_interaction_events_accepted_order_seq
  owned by user_interaction_events.accepted_order;
alter table user_interaction_events
  alter column accepted_order set default nextval('user_interaction_events_accepted_order_seq'),
  alter column accepted_order set not null;
create index if not exists user_interaction_events_user_issue_order_idx
  on user_interaction_events (user_id, issue_id, accepted_order desc, id desc);

create table if not exists user_issue_contributions (
  user_id uuid not null,
  issue_id uuid not null,
  category_code text not null,
  action_score numeric not null default 0,
  credited_dwell_ms integer not null default 0,
  dwell_score numeric not null default 0,
  last_action_event_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  constraint user_issue_contributions_pkey primary key (user_id, issue_id),
  constraint user_issue_contributions_user_fk foreign key (user_id)
    references users (id) on delete cascade,
  constraint user_issue_contributions_issue_fk foreign key (issue_id)
    references issues (id) on delete restrict,
  constraint user_issue_contributions_category_fk foreign key (category_code)
    references issue_categories (code) on delete restrict,
  constraint user_issue_contributions_event_fk foreign key (last_action_event_id)
    references user_interaction_events (id) on delete set null,
  constraint user_issue_contributions_action_score_check
    check (action_score in (-3, 0, 2)),
  constraint user_issue_contributions_dwell_ms_check
    check (credited_dwell_ms between 0 and 30000),
  constraint user_issue_contributions_dwell_score_check
    check (dwell_score in (0, 0.5, 1))
);
create index if not exists user_issue_contributions_category_idx
  on user_issue_contributions (user_id, category_code);

create table if not exists issue_detail_views (
  view_id uuid not null,
  user_id uuid not null,
  issue_id uuid not null,
  session_id uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  active_ms integer not null default 0,
  constraint issue_detail_views_pkey primary key (view_id),
  constraint issue_detail_views_user_fk foreign key (user_id)
    references users (id) on delete cascade,
  constraint issue_detail_views_issue_fk foreign key (issue_id)
    references issues (id) on delete restrict,
  constraint issue_detail_views_active_ms_check
    check (active_ms between 0 and 1800000),
  constraint issue_detail_views_expiry_check
    check (expires_at > started_at)
);
create index if not exists issue_detail_views_user_issue_idx
  on issue_detail_views (user_id, issue_id);
create index if not exists issue_detail_views_expires_at_idx
  on issue_detail_views (expires_at);
    `);
  }

  override down(): void {
    throw new Error(
      'Issue card action history is append-only; review dependent data before reverting this migration.',
    );
  }
}

export default Migration20260916000000IssueCardActions;
