import { defineEntity, p, type EntitySchema } from '@mikro-orm/core';

/**
 * Metadata for the existing users table plus the onboarding age-group delta.
 *
 * The table is owned by the application's base schema. This module only
 * describes the columns consumed by onboarding; it does not create the table.
 */
export const UserSchema = defineEntity({
  name: 'OnboardingUser',
  tableName: 'users',
  properties: {
    id: p.uuid().primary(),
    kakaoId: p.text().fieldName('kakao_id'),
    email: p.text().nullable(),
    onboardingStatus: p.text().fieldName('onboarding_status'),
    onboardingCompletedAt: p
      .datetime()
      .fieldName('onboarding_completed_at')
      .columnType('timestamptz')
      .nullable(),
    ageGroup: p.text().fieldName('age_group').nullable(),
    createdAt: p.datetime().fieldName('created_at').columnType('timestamptz'),
  },
});

/** Metadata for the existing entities master table. */
export const OnboardingEntitySchema = defineEntity({
  name: 'OnboardingEntity',
  tableName: 'entities',
  properties: {
    id: p.uuid().primary(),
    name: p.text(),
    type: p.text(),
    subtitle: p.text().nullable(),
    aliases: p.array<string>(),
    isActive: p.boolean().fieldName('is_active'),
    createdAt: p.datetime().fieldName('created_at').columnType('timestamptz'),
  },
});

/** Canonical category master. The stable category code is the primary key. */
export const IssueCategorySchema = defineEntity({
  name: 'IssueCategory',
  tableName: 'issue_categories',
  properties: {
    code: p.text().primary(),
    displayName: p.text().fieldName('display_name'),
    displayOrder: p.integer().fieldName('display_order'),
    createdAt: p.datetime().fieldName('created_at').columnType('timestamptz'),
  },
});

/** User/category preferences reference the category code directly. */
export const UserCategoryPreferenceSchema = defineEntity({
  name: 'UserCategoryPreference',
  tableName: 'user_category_preferences',
  properties: {
    userCategoryPreferencesId: p.uuid().fieldName('user_category_preferences_id').primary(),
    userId: p.uuid().fieldName('user_id'),
    categoryCode: p.text().fieldName('category_code'),
    weight: p.decimal('number').columnType('numeric'),
  },
  uniques: [
    {
      name: 'user_category_preferences_user_category_code_unique',
      properties: ['userId', 'categoryCode'],
    },
  ],
});

/** Metadata for the existing user/entity preference table. */
export const UserEntityPreferenceSchema = defineEntity({
  name: 'UserEntityPreference',
  tableName: 'user_entity_preferences',
  properties: {
    userEntityPreferenceId: p.uuid().fieldName('user_entity_preference_id').primary(),
    userId: p.uuid().fieldName('user_id'),
    entityId: p.uuid().fieldName('entity_id'),
    weight: p.decimal('number').columnType('numeric'),
  },
  uniques: [
    {
      name: 'user_entity_preferences_user_entity_unique',
      properties: ['userId', 'entityId'],
    },
  ],
});

/** Metadata for the onboarding region master table introduced by this migration. */
export const RegionSchema = defineEntity({
  name: 'Region',
  tableName: 'regions',
  properties: {
    code: p.text().primary(),
    name: p.text(),
    displayOrder: p.integer().fieldName('display_order'),
  },
  indexes: [
    {
      name: 'regions_display_order_idx',
      properties: 'displayOrder',
    },
  ],
});

/** Metadata for the onboarding region preference table introduced by this migration. */
export const UserRegionPreferenceSchema = defineEntity({
  name: 'UserRegionPreference',
  tableName: 'user_region_preferences',
  properties: {
    id: p.uuid().primary(),
    userId: p.uuid().fieldName('user_id'),
    regionCode: p.text().fieldName('region_code'),
    weight: p.decimal('number').columnType('numeric'),
  },
  uniques: [
    {
      name: 'user_region_preferences_user_region_unique',
      properties: ['userId', 'regionCode'],
    },
  ],
  indexes: [
    {
      name: 'user_region_preferences_user_id_idx',
      properties: 'userId',
    },
    {
      name: 'user_region_preferences_region_code_idx',
      properties: 'regionCode',
    },
  ],
});

/**
 * Entity schemas consumed by the MikroORM configuration.
 *
 * The values intentionally remain EntitySchema instances rather than
 * decorator-backed classes: this repository uses MikroORM 7 metadata APIs and
 * does not make decorators available to the core library.
 */
export const ONBOARDING_PERSISTENCE_ENTITIES = [
  UserSchema,
  OnboardingEntitySchema,
  IssueCategorySchema,
  UserCategoryPreferenceSchema,
  UserEntityPreferenceSchema,
  RegionSchema,
  UserRegionPreferenceSchema,
] as const satisfies readonly EntitySchema[];
