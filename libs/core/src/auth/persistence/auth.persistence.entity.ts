import { EntitySchema, type EntitySchema as EntitySchemaType } from '@mikro-orm/core';

export interface RefreshSessionPersistenceEntity {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Metadata for the opaque refresh-token session table. */
export const RefreshSessionSchema = new EntitySchema<RefreshSessionPersistenceEntity>({
  name: 'RefreshSession',
  tableName: 'refresh_sessions',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    userId: { type: String, columnType: 'uuid', fieldName: 'user_id' },
    tokenHash: { type: String, fieldName: 'token_hash' },
    expiresAt: { type: Date, fieldName: 'expires_at', columnType: 'timestamptz' },
    usedAt: {
      type: Date,
      fieldName: 'used_at',
      columnType: 'timestamptz',
      nullable: true,
    },
    revokedAt: {
      type: Date,
      fieldName: 'revoked_at',
      columnType: 'timestamptz',
      nullable: true,
    },
    createdAt: { type: Date, fieldName: 'created_at', columnType: 'timestamptz' },
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
] as const satisfies readonly EntitySchemaType[];
