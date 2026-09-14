import { Migration } from '@mikro-orm/migrations';

/**
 * Converts the shared category contract from UUID references to the canonical
 * lowercase category code. The migration intentionally fails closed for
 * legacy categories that do not have an approved mapping.
 */
export class Migration20260913000001CategoryCodePrimaryKey extends Migration {
  override up(): void {
    this.addSql(String.raw`
create temp table _newtine_category_catalog (
  code text primary key,
  display_name text not null,
  display_order integer not null
) on commit drop;

insert into _newtine_category_catalog (code, display_name, display_order) values
  ('housing', '주거', 1),
  ('labor', '일자리', 2),
  ('finance', '세금·금융', 3),
  ('welfare', '복지·연금', 4),
  ('education', '교육', 5),
  ('health', '보건·의료', 6),
  ('climate', '환경·기후', 7),
  ('security', '외교·안보', 8),
  ('local', '지역·교통', 9),
  ('politics', '정치·사법', 10);

create temp table _newtine_category_code_map (
  legacy_code text primary key,
  canonical_code text not null references _newtine_category_catalog(code)
) on commit drop;

insert into _newtine_category_code_map (legacy_code, canonical_code) values
  ('housing', 'housing'),
  ('labor', 'labor'),
  ('finance', 'finance'),
  ('welfare', 'welfare'),
  ('education', 'education'),
  ('health', 'health'),
  ('climate', 'climate'),
  ('security', 'security'),
  ('local', 'local'),
  ('politics', 'politics'),
  ('HOUSING', 'housing'),
  ('LABOR', 'labor'),
  ('FINANCE_TAX', 'finance'),
  ('EDUCATION', 'education'),
  ('WELFARE', 'welfare'),
  ('DIPLOMACY_SECURITY', 'security'),
  ('ENVIRONMENT_ENERGY', 'climate'),
  ('LOCAL', 'local'),
  ('JUDICIARY', 'politics'),
  ('ASSEMBLY_PARTY', 'politics');

create temp table _newtine_category_legacy (
  legacy_id uuid primary key,
  legacy_code text,
  canonical_code text references _newtine_category_catalog(code)
) on commit drop;

do $$
declare
  has_id boolean;
  has_code boolean;
  has_name boolean;
  has_display_name boolean;
  has_display_order boolean;
  has_created_at boolean;
begin
  if to_regclass('issue_categories') is null then
    create table issue_categories (
      code text primary key,
      display_name text not null,
      display_order integer not null,
      created_at timestamptz not null default now()
    );
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'id'
  ) into has_id;
  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'code'
  ) into has_code;
  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'name'
  ) into has_name;
  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'display_name'
  ) into has_display_name;
  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'display_order'
  ) into has_display_order;
  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'created_at'
  ) into has_created_at;

  if not has_code then
    alter table issue_categories add column code text;
  end if;
  if not has_display_name then
    if has_name then
      alter table issue_categories rename column name to display_name;
    else
      alter table issue_categories add column display_name text;
    end if;
  end if;
  if not has_display_order then
    alter table issue_categories add column display_order integer;
  end if;
  if not has_created_at then
    alter table issue_categories add column created_at timestamptz not null default now();
  end if;

  if has_id then
    execute $insert$
      insert into _newtine_category_legacy (legacy_id, legacy_code, canonical_code)
      select
        category.id,
        category.code,
        coalesce(
          (select map.canonical_code
             from _newtine_category_code_map map
            where map.legacy_code = category.code),
          case category.display_name
            when '주거' then 'housing'
            when '노동' then 'labor'
            when '일자리' then 'labor'
            when '금융·세제' then 'finance'
            when '세금·금융' then 'finance'
            when '교육' then 'education'
            when '복지' then 'welfare'
            when '복지·연금' then 'welfare'
            when '외교·안보' then 'security'
            when '안보' then 'security'
            when '환경·에너지' then 'climate'
            when '환경·기후' then 'climate'
            when '기후' then 'climate'
            when '지역' then 'local'
            when '지역·교통' then 'local'
            when '사법·검찰' then 'politics'
            when '정치·사법' then 'politics'
            when '정치' then 'politics'
            else null
          end
        )
      from issue_categories category
    $insert$;
  end if;
end
$$;

do $$
declare
  has_id boolean;
  invalid_count bigint;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'id'
  ) into has_id;

  if has_id then
    select count(*)
      into invalid_count
      from _newtine_category_legacy
     where canonical_code is null;
  else
    select count(*)
      into invalid_count
      from issue_categories category
     where not exists (
       select 1
         from _newtine_category_catalog catalog
        where catalog.code = category.code
     );
  end if;

  if invalid_count > 0 then
    raise exception
      'Category migration found % category master rows without an approved canonical code',
      invalid_count;
  end if;
end
$$;

do $$
declare
  has_category_id boolean;
  has_category_code boolean;
  invalid_count bigint;
begin
  if to_regclass('issues') is not null then
    select exists (
      select 1 from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'issues'
         and column_name = 'category_id'
    ) into has_category_id;
    select exists (
      select 1 from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'issues'
         and column_name = 'category_code'
    ) into has_category_code;

    if not has_category_code then
      alter table issues add column category_code text;
      has_category_code := true;
    end if;

    execute $map_code$
      update issues issue
         set category_code = map.canonical_code
        from _newtine_category_code_map map
       where issue.category_code = map.legacy_code
    $map_code$;

    if has_category_id then
      execute $conflict$
        select count(*)
          from issues issue
          join _newtine_category_legacy legacy
            on legacy.legacy_id = issue.category_id
         where issue.category_code is not null
           and issue.category_code <> legacy.canonical_code
      $conflict$ into invalid_count;
      if invalid_count > 0 then
        raise exception
          'Category migration found % issues with conflicting category_id and category_code values',
          invalid_count;
      end if;

      execute $map_id$
        update issues issue
           set category_code = legacy.canonical_code
          from _newtine_category_legacy legacy
         where issue.category_id = legacy.legacy_id
      $map_id$;
    end if;

    execute $check$
      select count(*)
        from issues issue
       where issue.category_code is null
          or not exists (
               select 1
                 from _newtine_category_catalog catalog
                where catalog.code = issue.category_code
             )
    $check$ into invalid_count;
    if invalid_count > 0 then
      raise exception
        'Category migration found % issues with an unmapped category code', invalid_count;
    end if;
  end if;

  if to_regclass('user_category_preferences') is not null then
    select exists (
      select 1 from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'user_category_preferences'
         and column_name = 'category_id'
    ) into has_category_id;
    select exists (
      select 1 from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'user_category_preferences'
         and column_name = 'category_code'
    ) into has_category_code;

    if not has_category_code then
      alter table user_category_preferences add column category_code text;
      has_category_code := true;
    end if;

    execute $map_code$
      update user_category_preferences preference
         set category_code = map.canonical_code
        from _newtine_category_code_map map
       where preference.category_code = map.legacy_code
    $map_code$;

    if has_category_id then
      execute $conflict$
        select count(*)
          from user_category_preferences preference
          join _newtine_category_legacy legacy
            on legacy.legacy_id = preference.category_id
         where preference.category_code is not null
           and preference.category_code <> legacy.canonical_code
      $conflict$ into invalid_count;
      if invalid_count > 0 then
        raise exception
          'Category migration found % preferences with conflicting category_id and category_code values',
          invalid_count;
      end if;

      execute $map_id$
        update user_category_preferences preference
           set category_code = legacy.canonical_code
          from _newtine_category_legacy legacy
         where preference.category_id = legacy.legacy_id
      $map_id$;
    end if;

    execute $check$
      select count(*)
        from user_category_preferences preference
       where preference.category_code is null
          or not exists (
               select 1
                 from _newtine_category_catalog catalog
                where catalog.code = preference.category_code
             )
    $check$ into invalid_count;
    if invalid_count > 0 then
      raise exception
        'Category migration found % user preferences with an unmapped category code', invalid_count;
    end if;

    execute $merge$
      with ranked as (
        select
          user_category_preferences_id,
          user_id,
          category_code,
          first_value(user_category_preferences_id) over (
            partition by user_id, category_code
            order by user_category_preferences_id
          ) as keep_id,
          sum(weight) over (partition by user_id, category_code) as merged_weight,
          row_number() over (
            partition by user_id, category_code
            order by user_category_preferences_id
          ) as row_number
        from user_category_preferences
      ), updated as (
        update user_category_preferences preference
           set weight = ranked.merged_weight
          from ranked
         where ranked.row_number = 1
           and preference.user_category_preferences_id = ranked.keep_id
        returning preference.user_category_preferences_id
      )
      delete from user_category_preferences preference
       using ranked
       where ranked.row_number > 1
         and preference.user_category_preferences_id = ranked.user_category_preferences_id
    $merge$;
  end if;
end
$$;

do $$
declare
  foreign_key record;
  category_constraint record;
  has_id boolean;
  category_id_attnum smallint;
  category_code_attnum smallint;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'id'
  ) into has_id;

  if has_id then
    select attnum
      into category_id_attnum
      from pg_attribute
     where attrelid = 'issue_categories'::regclass
       and attname = 'id'
       and not attisdropped;
    select attnum
      into category_code_attnum
      from pg_attribute
     where attrelid = 'issue_categories'::regclass
       and attname = 'code'
       and not attisdropped;

    for foreign_key in
      select
        constraint_record.conname,
        constraint_record.conrelid::regclass as relation_name
        from pg_constraint constraint_record
       where constraint_record.confrelid = 'issue_categories'::regclass
         and constraint_record.contype = 'f'
         and category_id_attnum = any (constraint_record.confkey)
    loop
      if foreign_key.relation_name::text not in ('issues', 'user_category_preferences') then
        raise exception
          'Category migration found an unsupported foreign key % on %',
          foreign_key.conname,
          foreign_key.relation_name;
      end if;
      execute format(
        'alter table %s drop constraint %I',
        foreign_key.relation_name,
        foreign_key.conname
      );
    end loop;

    for category_constraint in
      select constraint_record.conname
        from pg_constraint constraint_record
       where constraint_record.conrelid = 'issue_categories'::regclass
         and constraint_record.contype in ('p', 'u')
         and (
           category_id_attnum = any (constraint_record.conkey)
           or category_code_attnum = any (constraint_record.conkey)
         )
    loop
      execute format('alter table issue_categories drop constraint %I', category_constraint.conname);
    end loop;
  end if;

  drop index if exists issue_categories_code_unique;

  if to_regclass('user_category_preferences') is not null then
    for foreign_key in
      select constraint_record.conname
        from pg_constraint constraint_record
       where constraint_record.conrelid = 'user_category_preferences'::regclass
         and constraint_record.contype = 'u'
         and pg_get_constraintdef(constraint_record.oid) like '%category_id%'
    loop
      execute format(
        'alter table user_category_preferences drop constraint %I',
        foreign_key.conname
      );
    end loop;
  end if;

  if to_regclass('issues') is not null then
    alter table issues drop column if exists category_id;
  end if;
  if to_regclass('user_category_preferences') is not null then
    alter table user_category_preferences drop column if exists category_id;
  end if;
end
$$;

do $$
declare
  has_id boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'id'
  ) into has_id;

  if has_id then
    delete from issue_categories category
     using (
       select legacy_id
         from (
           select
             legacy.legacy_id,
             row_number() over (
               partition by legacy.canonical_code
               order by
                 (legacy.legacy_code = legacy.canonical_code) desc,
                 legacy.legacy_id
             ) as row_number
             from _newtine_category_legacy legacy
         ) ranked
        where ranked.row_number > 1
     ) duplicate
     where category.id = duplicate.legacy_id;

    update issue_categories category
       set code = legacy.canonical_code,
           display_name = catalog.display_name,
           display_order = catalog.display_order,
           created_at = coalesce(category.created_at, now())
      from _newtine_category_legacy legacy
      join _newtine_category_catalog catalog
        on catalog.code = legacy.canonical_code
     where category.id = legacy.legacy_id;
  end if;

  if has_id then
    insert into issue_categories (id, code, display_name, display_order, created_at)
    select seed.id, seed.code, seed.display_name, seed.display_order, now()
      from (
        values
          ('0199f000-0000-7000-8000-000000000101'::uuid, 'housing', '주거', 1),
          ('0199f000-0000-7000-8000-000000000102'::uuid, 'labor', '일자리', 2),
          ('0199f000-0000-7000-8000-000000000103'::uuid, 'finance', '세금·금융', 3),
          ('0199f000-0000-7000-8000-000000000104'::uuid, 'welfare', '복지·연금', 4),
          ('0199f000-0000-7000-8000-000000000105'::uuid, 'education', '교육', 5),
          ('0199f000-0000-7000-8000-000000000106'::uuid, 'health', '보건·의료', 6),
          ('0199f000-0000-7000-8000-000000000107'::uuid, 'climate', '환경·기후', 7),
          ('0199f000-0000-7000-8000-000000000108'::uuid, 'security', '외교·안보', 8),
          ('0199f000-0000-7000-8000-000000000109'::uuid, 'local', '지역·교통', 9),
          ('0199f000-0000-7000-8000-000000000110'::uuid, 'politics', '정치·사법', 10)
      ) seed(id, code, display_name, display_order)
     where not exists (
       select 1 from issue_categories category where category.code = seed.code
     );
  else
    insert into issue_categories (code, display_name, display_order, created_at)
    select catalog.code, catalog.display_name, catalog.display_order, now()
      from _newtine_category_catalog catalog
     where not exists (
       select 1 from issue_categories category where category.code = catalog.code
     );
  end if;

  update issue_categories category
     set display_name = catalog.display_name,
         display_order = catalog.display_order,
         created_at = coalesce(category.created_at, now())
    from _newtine_category_catalog catalog
   where category.code = catalog.code;

  select exists (
    select 1 from pg_constraint constraint_record
     where constraint_record.conrelid = 'issue_categories'::regclass
       and constraint_record.contype = 'p'
       and constraint_record.conkey = array[
         (select attnum from pg_attribute
           where attrelid = 'issue_categories'::regclass
             and attname = 'code'
             and not attisdropped)
       ]::smallint[]
  ) into has_id;
  if not has_id then
    alter table issue_categories add constraint issue_categories_pkey primary key (code);
  end if;

  alter table issue_categories alter column code set not null;
  alter table issue_categories alter column display_name set not null;
  alter table issue_categories alter column display_order set not null;

  if exists (
    select 1 from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'issue_categories'
       and column_name = 'id'
  ) then
    alter table issue_categories drop column id;
  end if;
end
$$;

do $$
begin
  if to_regclass('issues') is not null then
    alter table issues alter column category_code set not null;
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'issues'::regclass
         and conname = 'issues_category_code_fk'
    ) then
      alter table issues
        add constraint issues_category_code_fk
        foreign key (category_code) references issue_categories(code);
    end if;
  end if;

  if to_regclass('user_category_preferences') is not null then
    alter table user_category_preferences alter column category_code set not null;
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'user_category_preferences'::regclass
         and conname = 'user_category_preferences_category_code_fk'
    ) then
      alter table user_category_preferences
        add constraint user_category_preferences_category_code_fk
        foreign key (category_code) references issue_categories(code);
    end if;
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'user_category_preferences'::regclass
         and conname = 'user_category_preferences_user_category_code_unique'
    ) then
      alter table user_category_preferences
        add constraint user_category_preferences_user_category_code_unique
        unique (user_id, category_code);
    end if;
  end if;
end
$$;
    `);
  }

  override down(): void {
    throw new Error(
      'Category code primary-key migration is intentionally irreversible; restore from a verified backup before rollback.',
    );
  }
}

export default Migration20260913000001CategoryCodePrimaryKey;
