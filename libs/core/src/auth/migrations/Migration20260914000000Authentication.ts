import { Migration } from '@mikro-orm/migrations';

/**
 * Local email/password authentication schema.
 *
 * The base users table is owned by the application's existing schema history.
 * This migration intentionally records the kakao_id removal and fails closed
 * when existing data cannot satisfy the new canonical-email/role boundary.
 */
export class Migration20260914000000Authentication extends Migration {
  override up(): void {
    this.addSql('ALTER TABLE "users" DROP COLUMN IF EXISTS "kakao_id";');
    this.addSql('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;');
    this.addSql('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text;');

    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM "users"
           WHERE "email" IS NOT NULL
             AND btrim("email") = ''
        ) THEN
          RAISE EXCEPTION
            'Authentication migration requires non-empty email values when email is present';
        END IF;

        IF EXISTS (
          SELECT lower(btrim("email"))
            FROM "users"
           WHERE "email" IS NOT NULL
           GROUP BY lower(btrim("email"))
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION
            'Authentication migration cannot create the canonical email unique index because duplicate emails exist';
        END IF;
      END
      $$;
    `);

    this.addSql(`
      UPDATE "users"
         SET "role" = 'USER'
       WHERE "role" IS NULL
          OR btrim("role") = '';
    `);
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM "users"
           WHERE "role" NOT IN ('USER', 'ADMIN')
        ) THEN
          RAISE EXCEPTION
            'Authentication migration permits only USER and ADMIN roles';
        END IF;
      END
      $$;
    `);
    this.addSql('ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT \'USER\';');
    this.addSql('ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL;');
    this.addSql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'users_role_check'
             AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE "users"
            ADD CONSTRAINT "users_role_check"
            CHECK ("role" IN ('USER', 'ADMIN'));
        END IF;
      END
      $$;
    `);
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "users_email_canonical_unique"
        ON "users" (lower(btrim("email")))
       WHERE "email" IS NOT NULL;
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "refresh_sessions" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz NULL,
        "revoked_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "refresh_sessions_token_hash_unique" UNIQUE ("token_hash"),
        CONSTRAINT "refresh_sessions_user_fk"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      );
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "refresh_sessions_user_id_idx"
        ON "refresh_sessions" ("user_id");
      CREATE INDEX IF NOT EXISTS "refresh_sessions_active_lookup_idx"
        ON "refresh_sessions" ("user_id", "revoked_at", "used_at");
    `);
  }

  override down(): void {
    throw new Error(
      'Authentication migration is intentionally irreversible; review kakao_id and credential data removal before reverting it.',
    );
  }
}

export default Migration20260914000000Authentication;
