import { Migration } from '@mikro-orm/migrations';

/**
 * Makes every member-owned row reachable from users(id) deletion while
 * keeping guest feed sessions nullable and preserving shared content.
 *
 * This migration intentionally fails closed when the existing database has
 * orphaned member rows.  It never guesses whether an orphan should be
 * deleted or converted to a guest session.
 */
export class Migration20260917000000AccountWithdrawal extends Migration {
  override up(): void {
    this.addSql(String.raw`
do $$
declare
  fk_record record;
  table_name text;
begin
  if to_regclass('users') is null then
    raise exception 'Account withdrawal migration requires the users table';
  end if;

  for fk_record in
    select constraint_record.conrelid::regclass::text as relation_name,
           constraint_record.conname as constraint_name
      from pg_constraint constraint_record
     where constraint_record.confrelid = 'users'::regclass
       and constraint_record.contype = 'f'
       and not exists (
         select 1
           from (
             values
               ('user_category_preferences', 'user_id', 'c', true),
               ('user_entity_preferences', 'user_id', 'c', true),
               ('user_interaction_events', 'user_id', 'c', true),
               ('user_issue_contributions', 'user_id', 'c', true),
               ('issue_detail_views', 'user_id', 'c', true),
               ('refresh_sessions', 'user_id', 'c', true),
               ('weekly_reports', 'user_id', 'c', true),
               ('user_region_preferences', 'user_id', 'a', true),
               ('user_region_preferences', 'user_id', 'c', true),
               ('feed_sessions', 'user_id', 'c', true)
           ) as allowed(table_name, column_name, delete_action, is_validated)
          where constraint_record.connamespace = (
                  select relation_record.relnamespace
                    from pg_class relation_record
                   where relation_record.oid = 'users'::regclass
                )
            and allowed.table_name = (
                  select relation_record.relname
                    from pg_class relation_record
                   where relation_record.oid = constraint_record.conrelid
                )
            and allowed.column_name = (
                  select attribute_record.attname
                    from pg_attribute attribute_record
                   where attribute_record.attrelid = constraint_record.conrelid
                     and attribute_record.attnum = constraint_record.conkey[1]
                     and not attribute_record.attisdropped
                )
            and cardinality(constraint_record.conkey) = 1
            and cardinality(constraint_record.confkey) = 1
            and exists (
              select 1
                from pg_attribute referenced_attribute_record
               where referenced_attribute_record.attrelid = constraint_record.confrelid
                 and referenced_attribute_record.attnum = constraint_record.confkey[1]
                 and referenced_attribute_record.attname = 'id'
                 and not referenced_attribute_record.attisdropped
            )
            and constraint_record.convalidated = allowed.is_validated
            and constraint_record.confdeltype::text = allowed.delete_action
       )
  loop
    raise exception
      'Account withdrawal migration found an unexpected users foreign key on % (%)',
      fk_record.relation_name,
      fk_record.constraint_name;
  end loop;

  foreach table_name in array ARRAY[
    'user_category_preferences',
    'user_entity_preferences',
    'user_interaction_events',
    'user_issue_contributions',
    'issue_detail_views',
    'refresh_sessions',
    'weekly_reports',
    'user_region_preferences',
    'feed_sessions',
    'ai_usage_records'
  ] loop
    if to_regclass(table_name) is null then
      raise exception 'Account withdrawal migration requires the % table', table_name;
    end if;
  end loop;

  foreach table_name in array ARRAY[
    'user_category_preferences',
    'user_entity_preferences',
    'user_interaction_events',
    'user_issue_contributions',
    'issue_detail_views',
    'refresh_sessions',
    'weekly_reports'
  ] loop
    if not exists (
      select 1
        from pg_constraint constraint_record
        join pg_attribute attribute_record
          on attribute_record.attrelid = constraint_record.conrelid
         and attribute_record.attnum = constraint_record.conkey[1]
         and not attribute_record.attisdropped
        join pg_attribute referenced_attribute_record
          on referenced_attribute_record.attrelid = constraint_record.confrelid
         and referenced_attribute_record.attnum = constraint_record.confkey[1]
         and referenced_attribute_record.attname = 'id'
         and not referenced_attribute_record.attisdropped
       where constraint_record.conrelid = to_regclass(table_name)
         and constraint_record.confrelid = 'users'::regclass
         and constraint_record.contype = 'f'
         and constraint_record.convalidated
         and constraint_record.confdeltype = 'c'
         and attribute_record.attname = 'user_id'
         and cardinality(constraint_record.conkey) = 1
         and cardinality(constraint_record.confkey) = 1
    ) then
      raise exception
        'Account withdrawal migration requires a validated ON DELETE CASCADE user_id FK on %',
        table_name;
    end if;
  end loop;

  if not exists (
    select 1
      from pg_constraint constraint_record
      join pg_attribute attribute_record
        on attribute_record.attrelid = constraint_record.conrelid
       and attribute_record.attnum = constraint_record.conkey[1]
       and not attribute_record.attisdropped
      join pg_attribute referenced_attribute_record
        on referenced_attribute_record.attrelid = constraint_record.confrelid
       and referenced_attribute_record.attnum = constraint_record.confkey[1]
       and referenced_attribute_record.attname = 'id'
       and not referenced_attribute_record.attisdropped
     where constraint_record.conrelid = 'ai_usage_records'::regclass
       and constraint_record.confrelid = 'weekly_reports'::regclass
       and constraint_record.contype = 'f'
       and constraint_record.convalidated
       and constraint_record.confdeltype = 'n'
       and attribute_record.attname = 'weekly_report_id'
       and cardinality(constraint_record.conkey) = 1
       and cardinality(constraint_record.confkey) = 1
  ) then
    raise exception
      'Account withdrawal migration requires a validated ON DELETE SET NULL weekly_report_id FK';
  end if;

  if not exists (
    select 1
      from pg_constraint constraint_record
      join pg_attribute attribute_record
        on attribute_record.attrelid = constraint_record.conrelid
       and attribute_record.attnum = constraint_record.conkey[1]
       and not attribute_record.attisdropped
      join pg_attribute referenced_attribute_record
        on referenced_attribute_record.attrelid = constraint_record.confrelid
       and referenced_attribute_record.attnum = constraint_record.confkey[1]
       and referenced_attribute_record.attname = 'id'
       and not referenced_attribute_record.attisdropped
     where constraint_record.conrelid = 'user_region_preferences'::regclass
       and constraint_record.confrelid = 'users'::regclass
       and constraint_record.contype = 'f'
       and constraint_record.convalidated
       and constraint_record.confdeltype::text in ('a', 'c')
       and attribute_record.attname = 'user_id'
       and cardinality(constraint_record.conkey) = 1
       and cardinality(constraint_record.confkey) = 1
  ) then
    raise exception
      'Account withdrawal migration requires the existing validated user_region_preferences user_id FK';
  end if;

  if exists (
    select 1
      from user_region_preferences preference
      left join users user_record on user_record.id = preference.user_id
     where user_record.id is null
  ) then
    raise exception
      'Account withdrawal migration found orphaned user_region_preferences rows';
  end if;

  if exists (
    select 1
      from feed_sessions session
      left join users user_record on user_record.id = session.user_id
     where session.user_id is not null
       and user_record.id is null
  ) then
    raise exception
      'Account withdrawal migration found orphaned member feed_sessions rows';
  end if;
end
$$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_record.conname
      from pg_constraint constraint_record
      join pg_attribute attribute_record
        on attribute_record.attrelid = constraint_record.conrelid
       and attribute_record.attnum = constraint_record.conkey[1]
       and not attribute_record.attisdropped
     where constraint_record.conrelid = 'user_region_preferences'::regclass
       and constraint_record.confrelid = 'users'::regclass
       and constraint_record.contype = 'f'
       and attribute_record.attname = 'user_id'
       and cardinality(constraint_record.conkey) = 1
       and constraint_record.conkey[1] = attribute_record.attnum
  loop
    execute format(
      'alter table user_region_preferences drop constraint %I',
      constraint_name
    );
  end loop;

  for constraint_name in
    select constraint_record.conname
      from pg_constraint constraint_record
      join pg_attribute attribute_record
        on attribute_record.attrelid = constraint_record.conrelid
       and attribute_record.attnum = constraint_record.conkey[1]
       and not attribute_record.attisdropped
     where constraint_record.conrelid = 'feed_sessions'::regclass
       and constraint_record.confrelid = 'users'::regclass
       and constraint_record.contype = 'f'
       and attribute_record.attname = 'user_id'
       and cardinality(constraint_record.conkey) = 1
       and constraint_record.conkey[1] = attribute_record.attnum
  loop
    execute format(
      'alter table feed_sessions drop constraint %I',
      constraint_name
    );
  end loop;
end
$$;

alter table user_region_preferences
  add constraint user_region_preferences_user_fk
  foreign key (user_id) references users(id) on delete cascade;

alter table feed_sessions
  add constraint feed_sessions_user_fk
  foreign key (user_id) references users(id) on delete cascade;
    `);
  }

  override down(): void {
    throw new Error(
      'Account withdrawal migration is intentionally irreversible; review personal-data retention before reverting it.',
    );
  }
}

export default Migration20260917000000AccountWithdrawal;
