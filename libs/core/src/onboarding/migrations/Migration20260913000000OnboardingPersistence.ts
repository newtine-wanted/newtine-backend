import { Migration } from '@mikro-orm/migrations';

import { generateUuidV7 } from '../../common/id/uuidV7.generator.js';

const ONBOARDING_TOPIC_SEEDS = [
  { code: 'HOUSING', name: '주거', displayOrder: 1 },
  { code: 'LABOR', name: '노동', displayOrder: 2 },
  { code: 'FINANCE_TAX', name: '금융·세제', displayOrder: 3 },
  { code: 'EDUCATION', name: '교육', displayOrder: 4 },
  { code: 'WELFARE', name: '복지', displayOrder: 5 },
  { code: 'DIPLOMACY_SECURITY', name: '외교·안보', displayOrder: 6 },
  { code: 'ENVIRONMENT_ENERGY', name: '환경·에너지', displayOrder: 7 },
  { code: 'LOCAL', name: '지역', displayOrder: 8 },
  { code: 'YOUTH_GENERATION', name: '청년·세대', displayOrder: 9 },
  { code: 'JUDICIARY', name: '사법·검찰', displayOrder: 10 },
  { code: 'ASSEMBLY_PARTY', name: '국회·정당', displayOrder: 11 },
  { code: 'MEDIA', name: '미디어', displayOrder: 12 },
] as const;

/**
 * Onboarding's schema delta.
 *
 * The application base tables are owned by a separate schema history. This
 * migration deliberately assumes that users, entities, issue_categories,
 * user_category_preferences, and user_entity_preferences already exist.
 */
export class Migration20260913000000OnboardingPersistence extends Migration {
  override up(): void {
    const topicCatalogValues = ONBOARDING_TOPIC_SEEDS.map(
      ({ code, name, displayOrder }) => `('${code}', '${name}', ${displayOrder})`,
    ).join(',\n        ');
    const topicInsertValues = ONBOARDING_TOPIC_SEEDS.map(
      ({ code, name, displayOrder }) =>
        `('${generateUuidV7()}', '${code}', '${name}', ${displayOrder})`,
    ).join(',\n        ');
    const topicCodes = ONBOARDING_TOPIC_SEEDS.map(({ code }) => `'${code}'`).join(', ');

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
      ALTER TABLE "issue_categories"
        ADD COLUMN IF NOT EXISTS "code" text,
        ADD COLUMN IF NOT EXISTS "display_order" integer;
    `);

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "issue_categories_code_unique"
        ON "issue_categories" ("code")
       WHERE "code" IS NOT NULL;
    `);

    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM (
              VALUES
                ${topicCatalogValues}
            ) AS seed(code, name, display_order)
           WHERE EXISTS (
             SELECT 1
               FROM "issue_categories" AS category
              WHERE category."name" = seed.name
                AND category."code" IS NOT NULL
                AND category."code" <> seed.code
           )
              OR (
                SELECT COUNT(*)
                  FROM "issue_categories" AS category
                 WHERE category."name" = seed.name
                   AND category."code" IS NULL
              ) > 1
        ) THEN
          RAISE EXCEPTION
            'Cannot seed onboarding categories because an approved category name is ambiguous';
        END IF;
      END
      $$;
    `);

    this.addSql(`
      UPDATE "issue_categories" AS category
         SET "code" = seed.code,
             "display_order" = seed.display_order
        FROM (
          VALUES
            ${topicCatalogValues}
        ) AS seed(code, name, display_order)
       WHERE category."code" IS NULL
         AND category."name" = seed.name;
    `);

    this.addSql(`
      INSERT INTO "issue_categories" ("id", "code", "name", "display_order")
      VALUES
        ${topicInsertValues}
      ON CONFLICT ("code") WHERE "code" IS NOT NULL
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "display_order" = EXCLUDED."display_order";
    `);

    this.addSql(`
      DO $$
      DECLARE
        invalid_category_count bigint;
        invalid_issue_reference boolean;
        invalid_preference_reference boolean;
      BEGIN
        SELECT COUNT(*)
          INTO invalid_category_count
          FROM "issue_categories"
         WHERE "code" IS NULL
            OR "code" NOT IN (${topicCodes});

        IF invalid_category_count > 0 THEN
          RAISE EXCEPTION
            'Onboarding category migration requires every issue_categories row to use an approved code; found % invalid rows',
            invalid_category_count;
        END IF;

        IF to_regclass('issues') IS NOT NULL THEN
          EXECUTE $query$
            SELECT EXISTS (
              SELECT 1
                FROM "issues" AS issue
                LEFT JOIN "issue_categories" AS category ON category."id" = issue."category_id"
               WHERE category."id" IS NULL
                  OR category."code" IS NULL
                  OR category."code" NOT IN (${topicCodes})
            )
          $query$ INTO invalid_issue_reference;

          IF invalid_issue_reference THEN
            RAISE EXCEPTION
              'Onboarding category migration requires every issue.category_id to resolve to an approved category code';
          END IF;
        END IF;

        SELECT EXISTS (
          SELECT 1
            FROM "user_category_preferences" AS preference
            LEFT JOIN "issue_categories" AS category ON category."id" = preference."category_id"
           WHERE category."id" IS NULL
              OR category."code" IS NULL
              OR category."code" NOT IN (${topicCodes})
        )
          INTO invalid_preference_reference;

        IF invalid_preference_reference THEN
          RAISE EXCEPTION
            'Onboarding category migration requires every user_category_preferences.category_id to resolve to an approved category code';
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
           WHERE conname = 'user_category_preferences_user_category_unique'
             AND conrelid = 'user_category_preferences'::regclass
        ) THEN
          IF EXISTS (
            SELECT 1
              FROM "user_category_preferences"
             GROUP BY "user_id", "category_id"
            HAVING COUNT(*) > 1
          ) THEN
            RAISE EXCEPTION
              'Cannot add user_category_preferences unique constraint because duplicate rows exist';
          ELSE
            ALTER TABLE "user_category_preferences"
              ADD CONSTRAINT "user_category_preferences_user_category_unique"
              UNIQUE ("user_id", "category_id");
          END IF;
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
