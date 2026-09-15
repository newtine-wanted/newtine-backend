import { Migration } from '@mikro-orm/migrations';

/**
 * Restores anonymous feed ownership after the temporary member-only migration.
 * Existing member sessions remain member-owned; guest sessions use a server
 * issued cookie token hash and never point at a user row.
 */
export class Migration20260915000002GuestFeed extends Migration {
  override up(): void {
    this.addSql(String.raw`
do $$
begin
  if to_regclass('feed_sessions') is null then
    raise exception 'Guest feed migration requires the feed_sessions table';
  end if;
end
$$;

alter table feed_sessions
  add column if not exists guest_token_hash text,
  alter column user_id drop not null;

do $$
begin
  if exists (
    select 1
      from feed_sessions
     where (user_id is null and guest_token_hash is null)
        or (user_id is not null and guest_token_hash is not null)
  ) then
    raise exception 'Guest feed migration found a feed session without exactly one owner';
  end if;

  if exists (
    select 1
      from feed_sessions
     where guest_token_hash is not null
       and guest_token_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Guest feed migration found an invalid guest token hash';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'feed_sessions'::regclass
       and conname = 'feed_sessions_owner_check'
  ) then
    alter table feed_sessions
      add constraint feed_sessions_owner_check
        check ((user_id is not null) <> (guest_token_hash is not null));
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'feed_sessions'::regclass
       and conname = 'feed_sessions_guest_token_hash_check'
  ) then
    alter table feed_sessions
      add constraint feed_sessions_guest_token_hash_check
        check (guest_token_hash is null or guest_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end
$$;

drop index if exists feed_sessions_user_active_idx;
create index if not exists feed_sessions_member_active_idx
  on feed_sessions (user_id, status, expires_at)
  where user_id is not null;
create index if not exists feed_sessions_guest_active_idx
  on feed_sessions (guest_token_hash, status, expires_at)
  where guest_token_hash is not null;
    `);
  }

  override down(): void {
    throw new Error(
      'Guest feed migration is intentionally irreversible; review anonymous session data before reverting it.',
    );
  }
}

export default Migration20260915000002GuestFeed;
