import { Migration } from '@mikro-orm/migrations';
export class Migration20260920000300NewsValidation extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table news_validation_runs (
        id uuid primary key,
        generation_run_id uuid not null unique references news_generation_runs(id),
        owner uuid not null,
        status text not null check (status in ('RUNNING', 'FAILED', 'COMPLETED')),
        snapshot jsonb not null,
        error_code text,
        heartbeat_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        finished_at timestamptz
      );
      create unique index news_validation_single_running on news_validation_runs ((true)) where status = 'RUNNING';
    `);
  }
  override async down(): Promise<void> {
    this.addSql('drop table news_validation_runs');
  }
}
