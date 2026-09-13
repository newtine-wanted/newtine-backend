import type { IssueRecord, UserRecommendationContext } from '@newtine/core';

export interface IssueDetailResult {
  issue: IssueRecord;
  context: UserRecommendationContext | null;
}
