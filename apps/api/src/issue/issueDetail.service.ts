import { Inject, Injectable } from '@nestjs/common';

import {
  ISSUE_QUERY_REPOSITORY,
  IssueException,
  IssueExceptionCode,
  type IssueQueryRepository,
} from '@newtine/core';

import type { IssueDetailResult } from './type/issueDetail.output.js';

@Injectable()
export class IssueDetailService {
  constructor(@Inject(ISSUE_QUERY_REPOSITORY) private readonly repository: IssueQueryRepository) {}

  async get(issueId: string, userId: string | null): Promise<IssueDetailResult> {
    const issue = await this.repository.findIssue(issueId);
    if (
      issue === null ||
      issue.publicationStatus !== 'PUBLISHED' ||
      issue.integratedSummary === null ||
      issue.summaryLines.length !== 3 ||
      issue.summaryLines.some((line) => typeof line !== 'string' || line.trim().length === 0) ||
      !Number.isFinite(issue.freshnessScore) ||
      issue.freshnessScore < 0 ||
      issue.freshnessScore > 1 ||
      !Number.isFinite(issue.importanceScore) ||
      issue.importanceScore < 0 ||
      issue.importanceScore > 1
    ) {
      throw new IssueException(IssueExceptionCode.NotFound, '이슈를 찾을 수 없습니다.');
    }
    const context = userId === null ? null : await this.repository.findUserContext(userId);
    return { issue: removeUnknownArticleReferences(issue), context };
  }
}

function removeUnknownArticleReferences(
  issue: IssueDetailResult['issue'],
): IssueDetailResult['issue'] {
  const articleIds = new Set(issue.articles.map((article) => article.id));
  return {
    ...issue,
    viewpoints:
      issue.viewpoints
        ?.map((viewpoint) => ({
          ...viewpoint,
          articleIds: viewpoint.articleIds.filter((articleId) => articleIds.has(articleId)),
        }))
        .filter((viewpoint) => viewpoint.articleIds.length > 0) ?? null,
    glossary: issue.glossary
      .map((item) => ({
        ...item,
        articleIds: item.articleIds.filter((articleId) => articleIds.has(articleId)),
      }))
      .filter((item) => item.articleIds.length > 0),
  };
}
