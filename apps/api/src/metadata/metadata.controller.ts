import { TypedException, TypedQuery, TypedRoute } from '@nestia/core';
import { Controller } from '@nestjs/common';
import typia from 'typia';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';
import { MetadataService } from './metadata.service.js';
import type { PoliticalActorQuery } from './type/metadata.request.js';
import {
  toMetadataAgeGroups,
  toMetadataCategories,
  toMetadataRegions,
  toPoliticalActorSearchResponse,
} from './type/metadata.response.js';
import type {
  MetadataAgeGroupCollectionResponse,
  MetadataCategoryCollectionResponse,
  MetadataRegionCollectionResponse,
  PoliticalActorSearchResponse,
} from './type/metadata.response.js';

@Controller('metadata')
export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {}

  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get('categories')
  async getCategories(): Promise<MetadataCategoryCollectionResponse> {
    return toMetadataCategories(await this.metadataService.getCatalog());
  }

  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get('age-groups')
  async getAgeGroups(): Promise<MetadataAgeGroupCollectionResponse> {
    return toMetadataAgeGroups(await this.metadataService.getCatalog());
  }

  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get('regions')
  async getRegions(): Promise<MetadataRegionCollectionResponse> {
    return toMetadataRegions(await this.metadataService.getCatalog());
  }

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get('political-actors')
  async searchPoliticalActors(
    @TypedQuery<PoliticalActorQuery>({
      type: 'validate',
      validate: (input) => typia.http.validateQuery<PoliticalActorQuery>(input),
    })
    query: PoliticalActorQuery,
  ): Promise<PoliticalActorSearchResponse> {
    return toPoliticalActorSearchResponse(
      await this.metadataService.searchPoliticalActors({
        query: query.q,
        type: query.type,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      }),
    );
  }
}
