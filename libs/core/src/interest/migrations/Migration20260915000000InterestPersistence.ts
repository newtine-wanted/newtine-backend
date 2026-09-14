import { Migration } from '@mikro-orm/migrations';

/** Immutable user actions used by the My Page interest read model. */
export class Migration20260915000000InterestPersistence extends Migration {
  override up(): void {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "user_interaction_events" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "issue_id" uuid NOT NULL,
        "session_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "dwell_time" integer,
        "previous_action" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "user_interaction_events_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "user_interaction_events_user_fk"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "user_interaction_events_issue_fk"
          FOREIGN KEY ("issue_id") REFERENCES "issues" ("id") ON DELETE RESTRICT,
        CONSTRAINT "user_interaction_events_event_type_check"
          CHECK ("event_type" IN ('LIKE', 'SKIP', 'PASS')),
        CONSTRAINT "user_interaction_events_dwell_time_check"
          CHECK ("dwell_time" IS NULL OR "dwell_time" >= 0),
        CONSTRAINT "user_interaction_events_previous_action_check"
          CHECK ("previous_action" IS NULL OR "previous_action" IN ('LIKE', 'SKIP', 'PASS'))
      );
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "user_interaction_events_user_issue_created_idx"
        ON "user_interaction_events" ("user_id", "issue_id", "created_at" DESC, "id" DESC);
      CREATE INDEX IF NOT EXISTS "user_interaction_events_user_created_idx"
        ON "user_interaction_events" ("user_id", "created_at" DESC);
    `);
  }

  override down(): void {
    throw new Error(
      'Interest interaction history is append-only; review dependent reports before reverting this migration.',
    );
  }
}

export default Migration20260915000000InterestPersistence;
