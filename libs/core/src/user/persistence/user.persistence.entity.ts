import { EntitySchema, type EntitySchema as EntitySchemaType } from '@mikro-orm/core';

/** Shared metadata for the base users table consumed by auth and onboarding. */
export interface UserPersistenceEntity {
  id: string;
  email: string | null;
  passwordHash: string | null;
  role: string;
  onboardingStatus: string;
  onboardingCompletedAt: Date | null;
  ageGroup: string | null;
  createdAt: Date;
}

export const UserSchema = new EntitySchema<UserPersistenceEntity>({
  name: 'User',
  tableName: 'users',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    email: { type: String, nullable: true },
    passwordHash: { type: String, fieldName: 'password_hash', nullable: true },
    role: { type: String },
    onboardingStatus: { type: String, fieldName: 'onboarding_status' },
    onboardingCompletedAt: {
      type: Date,
      fieldName: 'onboarding_completed_at',
      columnType: 'timestamptz',
      nullable: true,
    },
    ageGroup: { type: String, fieldName: 'age_group', nullable: true },
    createdAt: { type: Date, fieldName: 'created_at', columnType: 'timestamptz' },
  },
});

export const USER_PERSISTENCE_ENTITIES = [
  UserSchema,
] as const satisfies readonly EntitySchemaType[];
