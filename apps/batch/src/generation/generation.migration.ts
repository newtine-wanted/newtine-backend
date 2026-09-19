import { Migration } from '@mikro-orm/migrations';
export class Migration20260920000200NewsGeneration extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table news_terms (
        normalized_term text primary key,
        term text not null check (length(trim(term)) > 0),
        definition text not null check (length(trim(definition)) > 0),
        created_at timestamptz not null default now()
      );
      -- Reuse only unambiguous definitions from published content.
      insert into news_terms (normalized_term, term, definition)
      select lower(regexp_replace(trim(normalize(g->>'term', NFKC)), '\\s+', ' ', 'g')),
        min(g->>'term'), min(g->>'definition')
      from issue_details d join issues i on i.id = d.issue_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(d.glossary) = 'array' then d.glossary else '[]'::jsonb end) g
      where i.publication_status = 'PUBLISHED' and jsonb_typeof(g->'term') = 'string'
        and jsonb_typeof(g->'definition') = 'string' and length(trim(g->>'term')) > 0 and length(trim(g->>'definition')) > 0
      group by lower(regexp_replace(trim(normalize(g->>'term', NFKC)), '\\s+', ' ', 'g'))
      having count(distinct trim(g->>'definition')) = 1;
      create table news_generation_runs (
        id uuid primary key,
        collection_run_id uuid not null unique references news_collection_runs(id),
        owner uuid not null,
        status text not null check (status in ('RUNNING', 'FAILED', 'COMPLETED')),
        snapshot jsonb not null,
        error_code text,
        heartbeat_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        finished_at timestamptz
      );
      create unique index news_generation_single_running on news_generation_runs ((true)) where status = 'RUNNING';
    `);
  }
  override async down(): Promise<void> {
    this.addSql('drop table news_generation_runs; drop table news_terms;');
  }
}
