import type {
  CandidateDecision,
  DiscoveredArticle,
  ExistingIssueSummary,
  FetchedArticle,
  GeneratedIssueContent,
  IssueCandidate,
  PipelineJobRecord,
  ProviderOutput,
  SemanticValidationResult,
  UuidV7,
} from './pipeline.types.js';

export const NEWS_SEARCH_PROVIDER = Symbol('NEWS_SEARCH_PROVIDER');
export const ARTICLE_BODY_PROVIDER = Symbol('ARTICLE_BODY_PROVIDER');
export const CANDIDATE_CLASSIFIER = Symbol('CANDIDATE_CLASSIFIER');
export const CONTENT_GENERATOR = Symbol('CONTENT_GENERATOR');
export const SEMANTIC_VALIDATOR = Symbol('SEMANTIC_VALIDATOR');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export interface NewsSearchProvider {
  search(query: string, limit: number): Promise<ProviderOutput<DiscoveredArticle[]>>;
}

export interface ArticleBodyProvider {
  fetch(article: DiscoveredArticle): Promise<ProviderOutput<FetchedArticle>>;
}

export interface CandidateClassifier {
  classify(input: {
    articles: DiscoveredArticle[];
    existingIssues: ExistingIssueSummary[];
    maxCandidates: number;
  }): Promise<ProviderOutput<CandidateDecision[]>>;
}

export interface ContentGenerator {
  generate(input: {
    issueId: UuidV7;
    title: string;
    articles: FetchedArticle[];
  }): Promise<ProviderOutput<GeneratedIssueContent>>;
}

export interface SemanticValidator {
  validate(input: {
    issueId: UuidV7;
    content: GeneratedIssueContent;
    articles: FetchedArticle[];
  }): Promise<ProviderOutput<SemanticValidationResult>>;
}

export interface EmbeddingProvider {
  embed(
    input: string,
    model?: string,
  ): Promise<ProviderOutput<{ model: string; vector: number[] }>>;
}

export type { IssueCandidate, PipelineJobRecord };
