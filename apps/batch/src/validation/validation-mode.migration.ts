import { Migration } from '@mikro-orm/migrations';
export class Migration20260920000400NewsValidationMode extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table news_validation_runs add column validation_mode text not null default 'AI' check (validation_mode in ('AI', 'RULES_ONLY'));
      alter table news_validation_runs drop constraint news_validation_runs_generation_run_id_key;
      alter table news_validation_runs add constraint news_validation_source_mode_unique unique (generation_run_id, validation_mode);
    `);
  }
  override async down(): Promise<void> {
    throw new Error('Validation mode history must be preserved');
  }
}
