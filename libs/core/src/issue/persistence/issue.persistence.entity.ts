import { EntitySchema, type EntitySchema as EntitySchemaType } from '@mikro-orm/core';

/** Read model for the existing issues table. */
export interface Issue {
  id: string;
  categoryCode: string;
  title: string;
  mainTopic: string | null;
  representativeEntityId: string | null;
  publicationStatus: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  eventAt: Date | null;
  subCategory: string | null;
  freshnessScore: number;
  importanceScore: number;
}

/** MikroORM schema for the issue feature's existing table. */
export const IssueSchema = new EntitySchema<Issue>({
  name: 'Issue',
  tableName: 'issues',
  properties: {
    id: { type: String, columnType: 'uuid', primary: true },
    categoryCode: { type: String, fieldName: 'category_code' },
    title: { type: String },
    mainTopic: { type: String, fieldName: 'main_topic', nullable: true },
    representativeEntityId: {
      type: String,
      columnType: 'uuid',
      fieldName: 'representative_entity_id',
      nullable: true,
    },
    publicationStatus: { type: String, fieldName: 'publication_status' },
    publishedAt: {
      type: Date,
      fieldName: 'published_at',
      columnType: 'timestamptz',
      nullable: true,
    },
    createdAt: { type: Date, fieldName: 'created_at', columnType: 'timestamptz' },
    updatedAt: { type: Date, fieldName: 'updated_at', columnType: 'timestamptz' },
    eventAt: { type: Date, columnType: 'timestamptz', fieldName: 'event_at', nullable: true },
    subCategory: { type: String, fieldName: 'sub_category', nullable: true },
    freshnessScore: { type: Number, columnType: 'numeric', fieldName: 'freshness_score' },
    importanceScore: { type: Number, columnType: 'numeric', fieldName: 'importance_score' },
  },
});

export const ISSUE_PERSISTENCE_ENTITIES = [
  IssueSchema,
] as const satisfies readonly EntitySchemaType[];
