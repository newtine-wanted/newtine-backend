import { defineEntity, p, type EntitySchema } from '@mikro-orm/core';

/** Metadata for the opaque refresh-token session table. */
export const RefreshSessionSchema = defineEntity({
  name: 'RefreshSession',
  tableName: 'refresh_sessions',
  properties: {
    id: p.uuid().primary(),
    userId: p.uuid().fieldName('user_id'),
    tokenHash: p.text().fieldName('token_hash'),
    expiresAt: p.datetime().fieldName('expires_at').columnType('timestamptz'),
    usedAt: p.datetime().fieldName('used_at').columnType('timestamptz').nullable(),
    revokedAt: p.datetime().fieldName('revoked_at').columnType('timestamptz').nullable(),
    createdAt: p.datetime().fieldName('created_at').columnType('timestamptz'),
  },
  uniques: [
    {
      name: 'refresh_sessions_token_hash_unique',
      properties: 'tokenHash',
    },
  ],
  indexes: [
    {
      name: 'refresh_sessions_user_id_idx',
      properties: 'userId',
    },
  ],
});

export const AUTH_PERSISTENCE_ENTITIES = [
  RefreshSessionSchema,
] as const satisfies readonly EntitySchema[];
