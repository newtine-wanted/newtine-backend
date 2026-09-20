import { Migration } from '@mikro-orm/migrations';
export class Migration20260920000500NewsValidationTone extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table news_validation_runs drop constraint news_validation_runs_validation_mode_check;
      alter table news_validation_runs add constraint news_validation_runs_validation_mode_check
        check (validation_mode in ('AI', 'RULES_ONLY', 'TONE'));
    `);
  }
  override async down(): Promise<void> {
    throw new Error('Validation tone history must be preserved');
  }
}
