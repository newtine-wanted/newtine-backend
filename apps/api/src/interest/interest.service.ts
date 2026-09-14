import { Inject, Injectable } from '@nestjs/common';

import {
  INTEREST_REPOSITORY,
  type InterestAnalysisResult,
  type InterestRepository,
  type LikedIssuesResult,
  type UuidV7,
} from '@newtine/core';

import { INTEREST_OPTIONS, type InterestOptions } from './interest.options.js';
import type { LikedIssuesQuery } from './type/interest.request.js';
import { decodeInterestCursor, encodeInterestCursor } from './type/interest.cursor.js';

@Injectable()
export class InterestService {
  constructor(
    @Inject(INTEREST_REPOSITORY)
    private readonly interestRepository: InterestRepository,
    @Inject(INTEREST_OPTIONS)
    private readonly interestOptions: InterestOptions,
  ) {}

  async getInterestAnalysis(userId: UuidV7): Promise<InterestAnalysisResult> {
    const asOf = new Date();
    const endAt = asOf;
    const startAt = new Date(
      endAt.getTime() - this.interestOptions.analysisWindowDays * 24 * 60 * 60 * 1000,
    );
    const snapshot = await this.interestRepository.getInterestAnalysis(userId, { startAt, endAt });
    const sampleStatus =
      snapshot.issueCount === 0
        ? 'EMPTY'
        : snapshot.issueCount < this.interestOptions.minimumSampleSize
          ? 'LOW_SAMPLE'
          : 'READY';

    return {
      ...snapshot,
      asOf,
      period: {
        type: 'ROLLING_DAYS',
        days: this.interestOptions.analysisWindowDays,
        startAt,
        endAt,
        timeZone: 'Asia/Seoul',
      },
      sampleStatus,
      minimumSampleSize: this.interestOptions.minimumSampleSize,
    };
  }

  async getLikedIssues(userId: UuidV7, query: LikedIssuesQuery): Promise<LikedIssuesResult> {
    const asOf = new Date();
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeInterestCursor(query.cursor, query.categoryCode);
    return this.interestRepository.getLikedIssues(userId, {
      asOf,
      categoryCode: query.categoryCode,
      cursor,
      limit: query.limit ?? 20,
    });
  }

  encodeCursor = encodeInterestCursor;
}
