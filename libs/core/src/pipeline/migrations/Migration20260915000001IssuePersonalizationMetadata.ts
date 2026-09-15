import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the producer-owned issue metadata consumed by the personalized feed.
 *
 * Both values are nullable because existing producers do not provide them yet.
 * The migration deliberately does not backfill guessed values from category or
 * issue_entities; a representative entity must be resolved by the producer.
 */
export class Migration20260915000001IssuePersonalizationMetadata extends Migration {
  override up(): void {
    this.addSql(String.raw`
alter table issues
  add column if not exists main_topic text,
  add column if not exists representative_entity_id uuid;

do $$
begin
  if exists (
    select 1
      from issues
     where main_topic is not null
       and length(btrim(main_topic)) = 0
  ) then
    raise exception 'Issue personalization metadata migration found blank main_topic values';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'issues'::regclass
       and conname = 'issues_main_topic_nonblank'
  ) then
    alter table issues
      add constraint issues_main_topic_nonblank
        check (main_topic is null or length(btrim(main_topic)) > 0);
  end if;

  if to_regclass('entities') is null then
    raise exception 'Issue personalization metadata migration requires the entities table';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'issues'::regclass
       and conname = 'issues_representative_entity_fk'
  ) then
    alter table issues
      add constraint issues_representative_entity_fk
        foreign key (representative_entity_id) references entities(id) on delete restrict;
  end if;
end
$$;

create index if not exists issues_representative_entity_idx
  on issues (representative_entity_id)
  where representative_entity_id is not null;

do $$
declare
  missing text;
begin
  select string_agg(required.column_name, ', ' order by required.column_name)
    into missing
    from (values ('main_topic'), ('representative_entity_id')) as required(column_name)
   where not exists (
     select 1
       from information_schema.columns column_record
      where column_record.table_schema = current_schema()
        and column_record.table_name = 'issues'
        and column_record.column_name = required.column_name
   );
  if missing is not null then
    raise exception 'Issue personalization metadata schema validation failed; missing columns: %', missing;
  end if;
end
$$;
    `);
  }

  override down(): void {
    throw new Error(
      'Issue personalization metadata migration is intentionally irreversible; review producer data before reverting it.',
    );
  }
}

export default Migration20260915000001IssuePersonalizationMetadata;
