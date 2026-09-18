import { tags } from 'typia';

import type {
  AgeGroupValue,
  CategoryCode,
  EntitySearchResult,
  EntityTypeValue,
  OnboardingOptions,
} from '@newtine/core';

export interface MetadataCategoryResponse {
  readonly code: CategoryCode;
  readonly name: string;
  readonly displayOrder: number;
}

export interface MetadataAgeGroupResponse {
  readonly code: AgeGroupValue;
  readonly name: string;
  readonly displayOrder: number;
}

export interface MetadataRegionResponse {
  readonly code: string;
  readonly name: string;
  readonly displayOrder: number;
}

export interface PoliticalActorResponse {
  readonly id: string & tags.Format<'uuid'>;
  readonly name: string;
  readonly type: EntityTypeValue;
  readonly subtitle?: string;
  readonly aliases: readonly string[];
}

export interface PoliticalActorSearchResponse {
  readonly items: readonly PoliticalActorResponse[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export type MetadataCategoryCollectionResponse = readonly MetadataCategoryResponse[];
export type MetadataAgeGroupCollectionResponse = readonly MetadataAgeGroupResponse[];
export type MetadataRegionCollectionResponse = readonly MetadataRegionResponse[];

export function toMetadataCategories(
  options: OnboardingOptions,
): MetadataCategoryCollectionResponse {
  return options.topics.map(({ code, name, displayOrder }) => ({ code, name, displayOrder }));
}

export function toMetadataAgeGroups(
  options: OnboardingOptions,
): MetadataAgeGroupCollectionResponse {
  return options.ageGroups.map(({ code, name, displayOrder }) => ({ code, name, displayOrder }));
}

export function toMetadataRegions(options: OnboardingOptions): MetadataRegionCollectionResponse {
  return options.regions.map(({ code, name, displayOrder }) => ({ code, name, displayOrder }));
}

export function toPoliticalActorSearchResponse(
  result: EntitySearchResult,
): PoliticalActorSearchResponse {
  return {
    items: result.items.map((actor) => ({
      id: actor.id as PoliticalActorResponse['id'],
      name: actor.name,
      type: actor.type,
      ...(actor.subtitle === undefined ? {} : { subtitle: actor.subtitle }),
      aliases: actor.aliases,
    })),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  };
}
