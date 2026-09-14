import { Migration } from '@mikro-orm/migrations';

/**
 * Completes the read-model columns and relationships consumed by the issue-card
 * query adapter. The adapter must fail at migration time for an incomplete schema,
 * not at the first production feed request.
 */
export class Migration202609130004IssueCardQueryReadModel extends Migration {
  override up(): void {
    this.addSql(String.raw`
alter table issues
  add column if not exists event_at timestamptz,
  add column if not exists sub_category text,
  add column if not exists freshness_score numeric,
  add column if not exists importance_score numeric;

update issues set freshness_score = 0 where freshness_score is null;
update issues set importance_score = 0 where importance_score is null;

alter table issues
  alter column freshness_score set default 0,
  alter column freshness_score set not null,
  alter column importance_score set default 0,
  alter column importance_score set not null;

alter table issue_articles add column if not exists sort_order integer;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
      from pg_constraint
     where conrelid = 'issue_impacts'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~* 'target_(type|value)'
  loop
    execute format('alter table issue_impacts drop constraint %I', constraint_record.conname);
  end loop;
end
$$;

alter table issue_impacts
  add constraint issue_impacts_target_type_check
    check (target_type in ('AGE_GROUP', 'REGION')),
  add constraint issue_impacts_target_value_check
    check (
      (target_type = 'AGE_GROUP' and target_value in ('AGE_19_34', 'AGE_35_49', 'AGE_50_64', 'AGE_65_PLUS'))
      or (target_type = 'REGION' and length(trim(target_value)) > 0)
    );

create table if not exists issue_entities (
  issue_entities_id uuid primary key,
  issue_id uuid not null references issues(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete restrict
);

create unique index if not exists issue_entities_issue_entity_unique
  on issue_entities (issue_id, entity_id);
create index if not exists issue_entities_entity_idx on issue_entities (entity_id, issue_id);

create table if not exists issue_relations (
  from_issue_id uuid not null references issues(id) on delete cascade,
  to_issue_id uuid not null references issues(id) on delete cascade,
  relation_type text not null check (relation_type in ('FOLLOW_UP')),
  reason text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  verified_at timestamptz not null,
  primary key (from_issue_id, to_issue_id, relation_type),
  check (from_issue_id <> to_issue_id)
);

create index if not exists issue_relations_from_verified_idx
  on issue_relations (from_issue_id, verified_at, to_issue_id)
  where relation_type = 'FOLLOW_UP' and verified_at is not null;

do $$
declare
  missing text;
begin
  select string_agg(required.column_name, ', ' order by required.column_name)
    into missing
    from (values
      ('id'),
      ('title'),
      ('category_code'),
      ('event_at'),
      ('sub_category'),
      ('publication_status'),
      ('freshness_score'),
      ('importance_score'),
      ('published_at'),
      ('updated_at')
    ) as required(column_name)
   where not exists (
     select 1
       from information_schema.columns column_record
      where column_record.table_schema = current_schema()
        and column_record.table_name = 'issues'
        and column_record.column_name = required.column_name
   );
  if missing is not null then
    raise exception 'Issue card query schema validation failed for issues; missing columns: %', missing;
  end if;

  select string_agg(required.column_name, ', ' order by required.column_name)
    into missing
    from (values
      ('issue_id', 'issue_articles'),
      ('article_id', 'issue_articles'),
      ('sort_order', 'issue_articles')
    ) as required(column_name, table_name)
   where not exists (
     select 1
       from information_schema.columns column_record
      where column_record.table_schema = current_schema()
        and column_record.table_name = required.table_name
        and column_record.column_name = required.column_name
   );
  if missing is not null then
    raise exception 'Issue card query schema validation failed for issue_articles; missing columns: %', missing;
  end if;

  if to_regclass('issue_entities') is null or to_regclass('issue_relations') is null then
    raise exception 'Issue card query schema validation failed; relationship tables are missing';
  end if;

  select string_agg(
      format('%s.%s', required.table_name, required.column_name),
      ', ' order by required.table_name, required.column_name
    )
    into missing
    from (values
      ('issue_entities', 'issue_entities_id'),
      ('issue_entities', 'issue_id'),
      ('issue_entities', 'entity_id'),
      ('issue_relations', 'from_issue_id'),
      ('issue_relations', 'to_issue_id'),
      ('issue_relations', 'relation_type'),
      ('issue_relations', 'reason'),
      ('issue_relations', 'evidence_refs'),
      ('issue_relations', 'verified_at')
    ) as required(table_name, column_name)
   where not exists (
     select 1
       from information_schema.columns column_record
      where column_record.table_schema = current_schema()
        and column_record.table_name = required.table_name
        and column_record.column_name = required.column_name
   );
  if missing is not null then
    raise exception 'Issue card query schema validation failed for relationship tables; missing columns: %', missing;
  end if;

  select string_agg(
      format('%s.%s', required.table_name, required.column_name),
      ', ' order by required.table_name, required.column_name
    )
    into missing
    from (values
      ('issue_categories', 'code'),
      ('issue_categories', 'display_name'),
      ('issue_details', 'issue_id'),
      ('issue_details', 'integrated_summary'),
      ('issue_details', 'summary_lines'),
      ('issue_details', 'viewpoints'),
      ('issue_details', 'glossary'),
      ('issue_articles', 'issue_id'),
      ('issue_articles', 'article_id'),
      ('articles', 'id'),
      ('articles', 'title'),
      ('articles', 'article_url'),
      ('articles', 'source_status'),
      ('articles', 'publisher_name'),
      ('articles', 'publisher_id'),
      ('articles', 'published_at'),
      ('publishers', 'id'),
      ('publishers', 'name'),
      ('issue_impacts', 'id'),
      ('issue_impacts', 'issue_id'),
      ('issue_impacts', 'target_type'),
      ('issue_impacts', 'target_value'),
      ('issue_impacts', 'description')
    ) as required(table_name, column_name)
   where not exists (
     select 1
       from information_schema.columns column_record
      where column_record.table_schema = current_schema()
        and column_record.table_name = required.table_name
        and column_record.column_name = required.column_name
   );
  if missing is not null then
    raise exception 'Issue card query schema validation failed for joined read-model tables; missing columns: %', missing;
  end if;
end
$$;
    `);
  }

  override down(): void {
    throw new Error(
      'Issue card query read-model migration is intentionally irreversible; review data removal before reverting it.',
    );
  }
}

export default Migration202609130004IssueCardQueryReadModel;
