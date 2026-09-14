import { Migration } from '@mikro-orm/migrations';

export class Migration202609130003IssueCardQuery extends Migration {
  override up(): void {
    this.addSql(String.raw`
create table if not exists feed_sessions (
  id uuid primary key,
  user_id uuid null,
  guest_token_hash text null,
  algorithm_version text not null,
  next_batch_no integer not null default 0 check (next_batch_no >= 0),
  status text not null check (status in ('ACTIVE', 'COMPLETED')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  last_topic text null,
  last_representative_entity_id uuid null,
  topic_run integer not null default 0 check (topic_run >= 0),
  entity_run integer not null default 0 check (entity_run >= 0),
  check ((user_id is not null) <> (guest_token_hash is not null))
);

create index if not exists feed_sessions_expires_at_idx on feed_sessions (expires_at);
create index if not exists feed_sessions_user_active_idx
  on feed_sessions (user_id, status, expires_at)
  where user_id is not null;

create table if not exists feed_batches (
  feed_session_id uuid not null references feed_sessions (id) on delete cascade,
  batch_no integer not null check (batch_no >= 0),
  continuation text not null check (continuation in ('CONTINUE', 'EXHAUSTED', 'CONSTRAINT_LIMITED', 'SEARCH_LIMITED')),
  created_at timestamptz not null,
  primary key (feed_session_id, batch_no)
);

create table if not exists feed_batch_items (
  feed_session_id uuid not null,
  batch_no integer not null,
  position integer not null check (position between 1 and 10),
  issue_id uuid not null,
  selection_type text not null check (selection_type in ('PERSONALIZED', 'MAJOR', 'CONNECTED', 'EXPLORATION', 'OPPOSITE')),
  reason_codes jsonb not null default '[]'::jsonb,
  primary key (feed_session_id, batch_no, position),
  unique (feed_session_id, issue_id),
  foreign key (feed_session_id, batch_no) references feed_batches (feed_session_id, batch_no) on delete cascade
);

create index if not exists feed_batch_items_issue_idx on feed_batch_items (issue_id);
    `);
  }

  override down(): void {
    throw new Error(
      'Issue card query schema migration is intentionally irreversible; review data removal before reverting it.',
    );
  }
}

export default Migration202609130003IssueCardQuery;
