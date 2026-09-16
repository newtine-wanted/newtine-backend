import { tags } from 'typia';

export interface IssueDetailArticle {
  id: string & tags.Format<'uuid'>;
  title: string;
  url: string;
  publisherName: string;
  publishedAt: (string & tags.Format<'date-time'>) | null;
}

export interface IssueDetailViewpoint {
  statement: string;
  articleIds: Array<string & tags.Format<'uuid'>>;
}

export interface IssueDetailGlossary {
  term: string;
  definition: string;
  articleIds: Array<string & tags.Format<'uuid'>>;
}

export interface IssueDetailImpact {
  targetType: 'AGE_GROUP' | 'REGION';
  targetValue: string;
  description: string;
  timing: string | null;
  action: string | null;
}

export interface IssueDetailResponse {
  id: string & tags.Format<'uuid'>;
  title: string;
  category: { code: string; name: string };
  subCategory: string | null;
  eventAt: (string & tags.Format<'date-time'>) | null;
  publishedAt: (string & tags.Format<'date-time'>) | null;
  updatedAt: string & tags.Format<'date-time'>;
  integratedSummary: string;
  summaryLines: [string, string, string];
  articleCount: number & tags.Type<'uint32'>;
  viewpoints: IssueDetailViewpoint[];
  glossary: IssueDetailGlossary[];
  articles: IssueDetailArticle[];
  impacts: IssueDetailImpact[];
  myAction: 'LIKE' | 'SKIP' | 'PASS' | null;
}
