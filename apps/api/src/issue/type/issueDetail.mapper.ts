import type { IssueDetailResponse } from './issueDetail.response.js';
import type { IssueDetailResult } from './issueDetail.output.js';

export function toIssueDetailResponse(result: IssueDetailResult): IssueDetailResponse {
  const { issue, context } = result;
  const ageGroup = context?.ageGroup;
  const preferredRegionCodes = context?.preferredRegionCodes ?? [];
  const impacts = issue.impacts.filter(
    (impact) =>
      (impact.targetType === 'REGION' && preferredRegionCodes.includes(impact.targetValue)) ||
      (impact.targetType === 'AGE_GROUP' && ageGroup !== null && impact.targetValue === ageGroup),
  );
  return {
    id: issue.id as IssueDetailResponse['id'],
    title: issue.title,
    category: { code: issue.categoryCode, name: issue.categoryName },
    subCategory: issue.subCategory,
    eventAt:
      issue.eventAt === null
        ? null
        : (issue.eventAt.toISOString() as IssueDetailResponse['eventAt']),
    publishedAt:
      issue.publishedAt === null
        ? null
        : (issue.publishedAt.toISOString() as IssueDetailResponse['publishedAt']),
    updatedAt: issue.updatedAt.toISOString() as IssueDetailResponse['updatedAt'],
    integratedSummary: issue.integratedSummary ?? '',
    summaryLines: normalizeSummaryLines(issue.summaryLines),
    articleCount: normalizeCount(issue.articleCount),
    viewpoints:
      issue.viewpoints?.map((viewpoint) => ({
        statement: viewpoint.statement,
        articleIds: viewpoint.articleIds as IssueDetailResponse['viewpoints'][number]['articleIds'],
      })) ?? [],
    glossary: issue.glossary.slice(0, 5).map((item) => ({
      term: item.term,
      definition: item.definition,
      articleIds: item.articleIds as IssueDetailResponse['glossary'][number]['articleIds'],
    })),
    articles: issue.articles.map((article) => ({
      id: article.id as IssueDetailResponse['articles'][number]['id'],
      title: article.title,
      url: article.url,
      publisherName: article.publisherName,
      publishedAt:
        article.publishedAt === null
          ? null
          : (article.publishedAt.toISOString() as IssueDetailResponse['articles'][number]['publishedAt']),
    })),
    impacts,
  };
}

function normalizeSummaryLines(lines: string[]): [string, string, string] {
  return [lines[0] ?? '', lines[1] ?? '', lines[2] ?? ''];
}

function normalizeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
