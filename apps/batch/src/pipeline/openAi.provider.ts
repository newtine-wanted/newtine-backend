import { Injectable } from '@nestjs/common';

import {
  PipelineAiConfiguration,
  type PipelineAiStage,
} from '@newtine/batch/pipeline/pipeline.ai.config.js';
import {
  pipelineExternalException,
  PIPELINE_CATEGORY_CODES,
  PipelineExceptionCode,
  isPipelineCategoryCode,
  isUuidV7,
  type CandidateClassifier,
  type CandidateDecision,
  type ContentGenerator,
  type EmbeddingProvider,
  type GeneratedIssueContent,
  type PipelineCategoryCode,
  type ProviderResult,
  type ProviderUsageMetadata,
  type SemanticValidator,
  type SemanticValidationResult,
  type UuidV7,
} from '@newtine/core';

const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const EMBEDDINGS_ENDPOINT = 'https://api.openai.com/v1/embeddings';
@Injectable()
export class OpenAiResponsesClient {
  private readonly apiKey = process.env.OPENAI_API_KEY;

  constructor(private readonly configuration: PipelineAiConfiguration) {}

  async json<T>(
    stage: Exclude<PipelineAiStage, 'embedding'>,
    input: string,
    schema: Record<string, unknown>,
  ): Promise<ProviderResult<T>> {
    if (this.apiKey === undefined || this.apiKey.trim().length === 0) {
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError);
    }
    const stageConfig = this.configuration.stage(stage);
    const prompt = stageConfig.prompt;
    if (prompt === undefined || stageConfig.schemaName === undefined) {
      throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
    }
    const payload = {
      model: stageConfig.model,
      store: false,
      input,
      text: { format: { type: 'json_schema', name: stageConfig.schemaName, strict: true, schema } },
    };
    const response = await this.request(RESPONSES_ENDPOINT, payload, 90_000);
    if (!response.ok)
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
        retryable: response.status === 429 || response.status >= 500,
      });
    const body = await readJsonBody(response);
    const text = extractOutputText(body);
    if (text === undefined) throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
    try {
      return {
        value: JSON.parse(text) as T,
        usage: extractUsageMetadata(body, response, {
          model: stageConfig.model,
          promptVersion: `${prompt.id}@${prompt.version}`,
          promptHash: prompt.hash,
        }),
      };
    } catch {
      throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
    }
  }

  async embedding(
    input: string,
    requestedModel = this.configuration.stage('embedding').model,
  ): Promise<ProviderResult<{ model: string; vector: number[] }>> {
    if (this.apiKey === undefined || this.apiKey.trim().length === 0)
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError);
    const model = requestedModel;
    const response = await this.request(
      EMBEDDINGS_ENDPOINT,
      { model, input, encoding_format: 'float' },
      30_000,
    );
    if (!response.ok)
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
        retryable: response.status === 429 || response.status >= 500,
      });
    const body = await readJsonBody(response);
    if (
      !isRecord(body) ||
      !Array.isArray(body.data) ||
      !isRecord(body.data[0]) ||
      !Array.isArray(body.data[0].embedding) ||
      body.data[0].embedding.some((value) => typeof value !== 'number')
    ) {
      throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
    }
    return {
      value: {
        model: typeof body.model === 'string' ? body.model : model,
        vector: body.data[0].embedding as number[],
      },
      usage: extractUsageMetadata(body, response, { model }),
    };
  }

  private async request(endpoint: string, payload: unknown, timeoutMs: number): Promise<Response> {
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
        retryable: true,
        resultUncertain: true,
        cause: error,
      });
    }
  }
}

@Injectable()
export class OpenAiCandidateClassifier implements CandidateClassifier {
  constructor(
    private readonly client: OpenAiResponsesClient,
    private readonly configuration: PipelineAiConfiguration,
  ) {}

  async classify(
    input: Parameters<CandidateClassifier['classify']>[0],
  ): Promise<ProviderResult<CandidateDecision[]>> {
    const prompt = [
      this.configuration.stage('candidate').prompt!.instruction,
      JSON.stringify({
        articles: input.articles.map((article) => ({
          id: article.id,
          title: article.title,
          description: article.description,
          sourceUrl: article.sourceUrl,
          publisherName: article.publisherName,
          publishedAt: article.publishedAt,
        })),
        existingIssues: input.existingIssues,
        maxCandidates: input.maxCandidates,
      }),
    ].join('\n');
    const result = await this.client.json<{
      candidates: Array<{
        title: string;
        scope: string;
        confirmedFacts: string[];
        sourceArticleIds: string[];
        categoryCode: string;
        searchQueries: string[];
        disposition: 'DUPLICATE' | 'NEW' | 'UNCERTAIN';
        existingIssueId: string | null;
        reason: string;
      }>;
    }>('candidate', prompt, {
      type: 'object',
      additionalProperties: false,
      required: ['candidates'],
      properties: {
        candidates: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'title',
              'scope',
              'confirmedFacts',
              'sourceArticleIds',
              'categoryCode',
              'searchQueries',
              'disposition',
              'existingIssueId',
              'reason',
            ],
            properties: {
              title: { type: 'string' },
              scope: { type: 'string' },
              confirmedFacts: { type: 'array', items: { type: 'string' } },
              sourceArticleIds: { type: 'array', items: { type: 'string' } },
              categoryCode: { type: 'string', enum: [...PIPELINE_CATEGORY_CODES] },
              searchQueries: { type: 'array', maxItems: 2, items: { type: 'string' } },
              disposition: { type: 'string', enum: ['DUPLICATE', 'NEW', 'UNCERTAIN'] },
              existingIssueId: { type: ['string', 'null'] },
              reason: { type: 'string' },
            },
          },
        },
      },
    });
    const decisions = result.value.candidates.map((candidate) => ({
      candidate: {
        title: candidate.title,
        scope: candidate.scope,
        confirmedFacts: candidate.confirmedFacts,
        // Keep malformed IDs visible to the worker. Filtering them here could turn a
        // malformed model result into a seemingly valid candidate with fewer sources.
        sourceArticleIds: candidate.sourceArticleIds as unknown as UuidV7[],
        categoryCode: requireCategoryCode(candidate.categoryCode),
        searchQueries: candidate.searchQueries.slice(0, 2),
      },
      disposition: candidate.disposition,
      ...(typeof candidate.existingIssueId === 'string' && isUuidV7(candidate.existingIssueId)
        ? { existingIssueId: candidate.existingIssueId as UuidV7 }
        : {}),
      reason: candidate.reason,
    }));
    return { value: decisions, usage: result.usage };
  }
}

@Injectable()
export class OpenAiContentGenerator implements ContentGenerator {
  constructor(
    private readonly client: OpenAiResponsesClient,
    private readonly configuration: PipelineAiConfiguration,
  ) {}

  async generate(
    input: Parameters<ContentGenerator['generate']>[0],
  ): Promise<ProviderResult<GeneratedIssueContent>> {
    const prompt = [
      this.configuration.stage('content').prompt!.instruction,
      JSON.stringify({
        issueId: input.issueId,
        title: input.title,
        articles: input.articles.map((article) => ({
          id: article.articleId,
          title: article.title,
          publisherName: article.publisherName,
          sourceUrl: article.sourceUrl,
          body: article.body.slice(0, 18_000),
        })),
      }),
    ].join('\n');
    return this.client.json<GeneratedIssueContent>('content', prompt, contentSchema());
  }
}

@Injectable()
export class OpenAiSemanticValidator implements SemanticValidator {
  constructor(
    private readonly client: OpenAiResponsesClient,
    private readonly configuration: PipelineAiConfiguration,
  ) {}

  async validate(
    input: Parameters<SemanticValidator['validate']>[0],
  ): Promise<ProviderResult<SemanticValidationResult>> {
    const prompt = [
      this.configuration.stage('validation').prompt!.instruction,
      JSON.stringify({
        issueId: input.issueId,
        generated: input.content,
        articles: input.articles.map((article) => ({
          id: article.articleId,
          title: article.title,
          publisherName: article.publisherName,
          body: article.body.slice(0, 18_000),
        })),
      }),
    ].join('\n');
    return this.client.json<SemanticValidationResult>('validation', prompt, {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'reason', 'independentEvidenceGroups', 'conflicts'],
      properties: {
        status: { type: 'string', enum: ['PASS', 'FAIL', 'UNCERTAIN'] },
        reason: { type: 'string' },
        independentEvidenceGroups: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
        },
        conflicts: { type: 'array', items: { type: 'string' } },
      },
    });
  }
}

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly client: OpenAiResponsesClient) {}

  embed(
    input: string,
    model?: string,
  ): Promise<ProviderResult<{ model: string; vector: number[] }>> {
    return this.client.embedding(input, model);
  }
}

function contentSchema(): Record<string, unknown> {
  const refs = { type: 'array', minItems: 1, items: { type: 'string' } };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['integratedSummary', 'summaryLines', 'viewpoints', 'glossary', 'impacts'],
    properties: {
      integratedSummary: { type: 'string' },
      summaryLines: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
      viewpoints: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['statement', 'articleIds'],
          properties: { statement: { type: 'string' }, articleIds: refs },
        },
      },
      glossary: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['term', 'definition', 'articleIds'],
          properties: {
            term: { type: 'string' },
            definition: { type: 'string' },
            articleIds: refs,
          },
        },
      },
      impacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['targetType', 'targetValue', 'description', 'articleIds'],
          properties: {
            targetType: { type: 'string', enum: ['AGE_GROUP'] },
            targetValue: {
              type: 'string',
              enum: ['AGE_19_34', 'AGE_35_49', 'AGE_50_64', 'AGE_65_PLUS'],
            },
            description: { type: 'string' },
            articleIds: refs,
          },
        },
      },
    },
  };
}

function extractOutputText(value: unknown): string | undefined {
  if (
    !isRecord(value) ||
    (value.status !== undefined && value.status !== 'completed') ||
    !Array.isArray(value.output)
  )
    return undefined;
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        (content.type === undefined || content.type === 'output_text') &&
        typeof content.text === 'string'
      )
        return content.text;
    }
  }
  return undefined;
}

function extractUsageMetadata(
  value: unknown,
  response: Response,
  defaults: {
    model: string;
    promptVersion?: string;
    promptHash?: string;
  },
): ProviderUsageMetadata | undefined {
  const record = isRecord(value) ? value : undefined;
  const usage = record !== undefined && isRecord(record.usage) ? record.usage : undefined;
  const model = stringValue(record?.model) ?? defaults.model;
  const promptVersion = defaults.promptVersion;
  const promptHash = defaults.promptHash;
  const requestIdFromBody = record === undefined ? undefined : stringValue(record.id);
  const requestIdFromHeader = response.headers.get('x-request-id') ?? undefined;
  const requestId = requestIdFromBody ?? requestIdFromHeader;
  const inputTokens = numberValue(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = numberValue(usage?.output_tokens ?? usage?.completion_tokens);
  return {
    model,
    ...(promptVersion === undefined ? {} : { promptVersion }),
    ...(promptHash === undefined ? {} : { promptHash }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

function requireCategoryCode(value: string): PipelineCategoryCode {
  if (!isPipelineCategoryCode(value))
    throw pipelineExternalException(PipelineExceptionCode.InvalidOutput);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonBody(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error: unknown) {
    throw pipelineExternalException(PipelineExceptionCode.UpstreamError, {
      retryable: true,
      resultUncertain: true,
      cause: error,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw pipelineExternalException(PipelineExceptionCode.InvalidOutput, { cause: error });
  }
}
