import type { DetailViewProgress, DetailViewStarted, InteractionAcceptance } from '@newtine/core';
import type {
  DetailViewProgressResponse,
  DetailViewStartResponse,
  IssueInteractionResponse,
} from './issueAction.response.js';

export function toIssueInteractionResponse(
  result: InteractionAcceptance,
): IssueInteractionResponse {
  return {
    eventId: result.eventId as IssueInteractionResponse['eventId'],
    issueId: result.issueId as IssueInteractionResponse['issueId'],
    acceptedAction: result.acceptedAction,
    acceptedAt: result.acceptedAt.toISOString() as IssueInteractionResponse['acceptedAt'],
  };
}

export function toDetailViewStartResponse(result: DetailViewStarted): DetailViewStartResponse {
  return {
    viewId: result.viewId as DetailViewStartResponse['viewId'],
    issueId: result.issueId as DetailViewStartResponse['issueId'],
    startedAt: result.startedAt.toISOString() as DetailViewStartResponse['startedAt'],
    expiresAt: result.expiresAt.toISOString() as DetailViewStartResponse['expiresAt'],
  };
}

export function toDetailViewProgressResponse(
  result: DetailViewProgress,
): DetailViewProgressResponse {
  return {
    viewId: result.viewId as DetailViewProgressResponse['viewId'],
    issueId: result.issueId as DetailViewProgressResponse['issueId'],
    acceptedActiveMilliseconds: result.acceptedActiveMilliseconds,
    totalCreditedMilliseconds: result.totalCreditedMilliseconds,
    dwellScore: result.dwellScore,
  };
}
