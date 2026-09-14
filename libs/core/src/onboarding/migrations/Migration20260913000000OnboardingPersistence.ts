import { Migration } from '@mikro-orm/migrations';

/**
 * Onboarding's schema delta.
 *
 * The application base tables are owned by a separate schema history. This
 * migration deliberately assumes that users, entities, issue_categories,
 * user_category_preferences, and user_entity_preferences already exist.
 */
export class Migration20260913000000OnboardingPersistence extends Migration {
  override up(): void {
    this.addSql(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "age_group" text;
    `);

    this.addSql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'users_age_group_allowed_check'
             AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE "users"
            ADD CONSTRAINT "users_age_group_allowed_check"
            CHECK (
              "age_group" IS NULL
              OR "age_group" IN ('AGE_19_34', 'AGE_35_49', 'AGE_50_64', 'AGE_65_PLUS')
            );
        END IF;
      END
      $$;
    `);

    this.addSql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'user_entity_preferences_user_entity_unique'
             AND conrelid = 'user_entity_preferences'::regclass
        ) THEN
          IF EXISTS (
            SELECT 1
              FROM "user_entity_preferences"
             GROUP BY "user_id", "entity_id"
            HAVING COUNT(*) > 1
          ) THEN
            RAISE EXCEPTION
              'Cannot add user_entity_preferences unique constraint because duplicate rows exist';
          ELSE
            ALTER TABLE "user_entity_preferences"
              ADD CONSTRAINT "user_entity_preferences_user_entity_unique"
              UNIQUE ("user_id", "entity_id");
          END IF;
        END IF;
      END
      $$;
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "regions" (
        "code" text NOT NULL,
        "name" text NOT NULL,
        "display_order" integer NOT NULL,
        CONSTRAINT "regions_pkey" PRIMARY KEY ("code")
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "user_region_preferences" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "region_code" text NOT NULL,
        "weight" numeric NOT NULL,
        CONSTRAINT "user_region_preferences_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "user_region_preferences_user_fk"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id"),
        CONSTRAINT "user_region_preferences_region_fk"
          FOREIGN KEY ("region_code") REFERENCES "regions" ("code")
      );
    `);

    this.addSql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'user_region_preferences_user_region_unique'
             AND conrelid = 'user_region_preferences'::regclass
        ) THEN
          IF EXISTS (
            SELECT 1
              FROM "user_region_preferences"
             GROUP BY "user_id", "region_code"
            HAVING COUNT(*) > 1
          ) THEN
            RAISE EXCEPTION
              'Cannot add user_region_preferences unique constraint because duplicate rows exist';
          ELSE
            ALTER TABLE "user_region_preferences"
              ADD CONSTRAINT "user_region_preferences_user_region_unique"
              UNIQUE ("user_id", "region_code");
          END IF;
        END IF;
      END
      $$;
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "regions_display_order_idx"
        ON "regions" ("display_order");
      CREATE INDEX IF NOT EXISTS "user_region_preferences_user_id_idx"
        ON "user_region_preferences" ("user_id");
      CREATE INDEX IF NOT EXISTS "user_region_preferences_region_code_idx"
        ON "user_region_preferences" ("region_code");
    `);

    this.addSql(`
      INSERT INTO "regions" ("code", "name", "display_order")
      VALUES
        ('SEOUL', '서울특별시', 1),
        ('BUSAN', '부산광역시', 2),
        ('DAEGU', '대구광역시', 3),
        ('INCHEON', '인천광역시', 4),
        ('GWANGJU', '광주광역시', 5),
        ('DAEJEON', '대전광역시', 6),
        ('ULSAN', '울산광역시', 7),
        ('SEJONG', '세종특별자치시', 8),
        ('GYEONGGI', '경기도', 9),
        ('GANGWON', '강원특별자치도', 10),
        ('CHUNGBUK', '충청북도', 11),
        ('CHUNGNAM', '충청남도', 12),
        ('JEONBUK', '전북특별자치도', 13),
        ('JEONNAM', '전라남도', 14),
        ('GYEONGBUK', '경상북도', 15),
        ('GYEONGNAM', '경상남도', 16),
        ('JEJU', '제주특별자치도', 17)
      ON CONFLICT ("code")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "display_order" = EXCLUDED."display_order";
    `);
  }

  override down(): void {
    throw new Error(
      'Onboarding persistence migration is intentionally irreversible; review data removal before reverting it.',
    );
  }
}

export default Migration20260913000000OnboardingPersistence;
