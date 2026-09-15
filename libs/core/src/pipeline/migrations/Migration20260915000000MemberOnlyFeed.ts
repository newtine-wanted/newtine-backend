import { Migration } from '@mikro-orm/migrations';

/**
 * Converts the issue-card feed session owner from member-or-guest to member-only.
 *
 * This migration fails closed when an earlier guest session already contains data;
 * it never silently deletes or reassigns an anonymous session.
 */
export class Migration20260915000000MemberOnlyFeed extends Migration {
  override up(): void {
    this.addSql(String.raw`
do $$
begin
  if to_regclass('feed_sessions') is null then
    raise exception 'Member-only feed migration requires the feed_sessions table';
  end if;

  if exists (
    select 1
      from feed_sessions
     where user_id is null
        or guest_token_hash is not null
  ) then
    raise exception 'Member-only feed migration found guest feed sessions; review data before continuing';
  end if;
end
$$;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
      from pg_constraint
     where conrelid = 'feed_sessions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%guest_token_hash%'
  loop
    execute format('alter table feed_sessions drop constraint %I', constraint_record.conname);
  end loop;
end
$$;

alter table feed_sessions
  alter column user_id set not null,
  drop column if exists guest_token_hash;

drop index if exists feed_sessions_user_active_idx;
create index if not exists feed_sessions_user_active_idx
  on feed_sessions (user_id, status, expires_at);
    `);
  }

  override down(): void {
    throw new Error(
      'Member-only feed migration is intentionally irreversible; review guest credential restoration before reverting it.',
    );
  }
}

export default Migration20260915000000MemberOnlyFeed;
