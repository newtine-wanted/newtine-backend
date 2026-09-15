import { EntitySchema, type EntitySchema as EntitySchemaType } from '@mikro-orm/core';

/** Read model for the existing issues table. */
export interface Issue {
  id: string;
  categoryCode: string;
  title: string;
  publicationStatus: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** MikroORM schema for the issue feature's existing table. */
export const IssueSchema = new EntitySchema<Issue>({
  name: 'Issue',
  tableName: 'issues',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    categoryCode: { type: String, fieldName: 'category_code' },
    title: { type: String },
    publicationStatus: { type: String, fieldName: 'publication_status' },
    publishedAt: {
      type: Date,
      fieldName: 'published_at',
      columnType: 'timestamptz',
      nullable: true,
    },
    createdAt: { type: Date, fieldName: 'created_at', columnType: 'timestamptz' },
    updatedAt: { type: Date, fieldName: 'updated_at', columnType: 'timestamptz' },
  },
});

export const ISSUE_PERSISTENCE_ENTITIES = [
  IssueSchema,
] as const satisfies readonly EntitySchemaType[];
