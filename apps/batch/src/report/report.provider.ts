import { Injectable } from '@nestjs/common';

import type {
  ReportContentDraft,
  ReportContentProvider,
  ReportProviderInput,
  ReportProviderOutput,
  ReportProviderResult,
  ReportProviderUsage,
  ReportSemanticValidation,
  ReportValidationInput,
} from '@newtine/core/report/report.content.js';
import { ReportAiConfiguration } from './report.ai.config.js';

const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

export type ReportProviderErrorCode =
  | 'MISSING_CREDENTIALS'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'INVALID_OUTPUT';

export class ReportProviderException extends Error {
  readonly code: ReportProviderErrorCode;
  readonly retryable: boolean;
  readonly resultUncertain: boolean;
  readonly usage: ReportProviderUsage | undefined;

  constructor(
    code: ReportProviderErrorCode,
    options: {
      retryable?: boolean;
      resultUncertain?: boolean;
      usage?: ReportProviderUsage;
      cause?: unknown;
    } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ReportProviderException';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.resultUncertain = options.resultUncertain ?? false;
    this.usage = options.usage;
  }
}

@Injectable()
export class ReportOpenAiResponsesClient {
  constructor(private readonly configuration: ReportAiConfiguration) {}

  async json<T>(
    purpose: 'generation' | 'validation',
    input: string,
    schema: Record<string, unknown>,
  ): Promise<ReportProviderResult<T>> {
    this.configuration.assertReady();
    const payload = {
      model: this.configuration.model,
      store: false,
      max_output_tokens: purpose === 'generation' ? 4_000 : 1_000,
      instructions:
        purpose === 'generation'
          ? this.configuration.generationPrompt.instruction
          : this.configuration.validationPrompt.instruction,
      input: [{ role: 'user', content: [{ type: 'input_text', text: input }] }],
      text: {
        format: {
          type: 'json_schema',
          name: `report_${purpose}`,
          strict: true,
          schema,
        },
      },
    };
    const response = await this.request(payload);
    if (!response.ok) {
      throw new ReportProviderException('UPSTREAM_ERROR', {
        retryable: response.status === 429 || response.status >= 500,
        resultUncertain: response.status === 429 || response.status >= 500,
        usage: requestUsage(this.configuration.model),
      });
    }
    const body = await readJsonBody(response, requestUsage(this.configuration.model));
    const text = extractOutputText(body);
    if (text === undefined) {
      throw new ReportProviderException('INVALID_OUTPUT', {
        usage: requestUsage(this.configuration.model),
      });
    }
    let value: T;
    try {
      value = JSON.parse(text) as T;
    } catch (error: unknown) {
      throw new ReportProviderException('INVALID_OUTPUT', {
        usage: requestUsage(this.configuration.model),
        cause: error,
      });
    }
    return {
      value,
      usage: extractUsage(body, this.configuration.model),
    };
  }

  private async request(payload: unknown): Promise<Response> {
    const apiKey = this.configuration.apiKey;
    if (apiKey === undefined) throw new ReportProviderException('MISSING_CREDENTIALS');
    try {
      return await fetch(RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.configuration.providerTimeoutMs),
      });
    } catch (error: unknown) {
      throw new ReportProviderException('TIMEOUT', {
        retryable: true,
        resultUncertain: true,
        cause: error,
      });
    }
  }
}

@Injectable()
export class ReportOpenAiProvider implements ReportContentProvider {
  constructor(
    private readonly client: ReportOpenAiResponsesClient,
    private readonly configuration: ReportAiConfiguration,
  ) {}

  async generate(input: ReportProviderInput): Promise<ReportProviderOutput<ReportContentDraft>> {
    const payload = {
      allowConnections: input.allowConnections,
      snapshot: snapshotForModel(input),
      candidates: candidatesForModel(input),
    };
    const prompt = JSON.stringify(payload);
    assertPromptSize(this.configuration.generationPrompt.instruction + prompt);
    return this.client.json<ReportContentDraft>(
      'generation',
      prompt,
      draftSchema(input.allowConnections),
    );
  }

  async validate(
    input: ReportValidationInput,
  ): Promise<ReportProviderOutput<ReportSemanticValidation>> {
    const payload = {
      allowConnections: input.allowConnections,
      snapshot: snapshotForModel(input),
      candidates: candidatesForModel(input),
      draft: input.draft,
    };
    const prompt = JSON.stringify(payload);
    assertPromptSize(this.configuration.validationPrompt.instruction + prompt);
    return this.client.json<ReportSemanticValidation>('validation', prompt, validationSchema());
  }
}

/** Friendly aliases used by module wiring and tests. */
export const OpenAiReportContentProvider = ReportOpenAiProvider;
export const OpenAiReportProvider = ReportOpenAiProvider;

function snapshotForModel(input: ReportProviderInput): unknown {
  return {
    capturedAt: input.input.capturedAt,
    issues: input.input.issues.map((issue) => ({
      issueId: issue.issueId,
      title: issue.title,
      categoryCode: issue.categoryCode,
      categoryName: issue.categoryName,
      summary: issue.summary,
      summaryLines: issue.summaryLines,
    })),
    categoryCounts: input.input.categoryCounts,
    excludedCount: input.input.excludedCount,
  };
}

function candidatesForModel(input: ReportProviderInput): unknown {
  return {
    capturedAt: input.candidates.capturedAt,
    related: input.candidates.related.map((candidate) => ({
      issueId: candidate.issueId,
      sourceIssueId: candidate.sourceIssueId,
      title: candidate.title,
      categoryCode: candidate.categoryCode,
      categoryName: candidate.categoryName,
      summary: candidate.summary,
      summaryLines: candidate.summaryLines,
    })),
    major: input.candidates.major.map((issue) => ({
      issueId: issue.issueId,
      title: issue.title,
      categoryCode: issue.categoryCode,
      categoryName: issue.categoryName,
      summary: issue.summary,
      summaryLines: issue.summaryLines,
    })),
    majorCategoryCodes: input.candidates.majorCategoryCodes,
    relatedUnavailable: input.candidates.relatedUnavailable,
  };
}

function draftSchema(allowConnections: boolean): Record<string, unknown> {
  const text = { type: 'string', minLength: 1, maxLength: 2_000 };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['connections', 'related'],
    properties: {
      connections: {
        type: 'array',
        minItems: allowConnections ? 0 : 0,
        maxItems: allowConnections ? 3 : 0,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'title', 'description', 'issueIds'],
          properties: {
            label: text,
            title: text,
            description: text,
            issueIds: { type: 'array', minItems: 2, items: { type: 'string' } },
          },
        },
      },
      related: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['issueId', 'sourceIssueId', 'reason'],
          properties: {
            issueId: { type: 'string' },
            sourceIssueId: { type: 'string' },
            reason: { type: 'string', minLength: 1, maxLength: 600 },
          },
        },
      },
    },
  };
}

function validationSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'reason'],
    properties: {
      status: { type: 'string', enum: ['PASS', 'FAIL', 'UNCERTAIN'] },
      reason: { type: 'string', minLength: 1, maxLength: 600 },
    },
  };
}

function extractOutputText(value: unknown): string | undefined {
  if (!isRecord(value) || (value.status !== undefined && value.status !== 'completed')) {
    return undefined;
  }
  if (!Array.isArray(value.output)) return undefined;
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        (content.type === undefined || content.type === 'output_text') &&
        typeof content.text === 'string'
      ) {
        return content.text;
      }
    }
  }
  return undefined;
}

function extractUsage(
  value: unknown,
  defaultModel: string,
): { model?: string; inputTokens?: number; outputTokens?: number } {
  const record = isRecord(value) ? value : undefined;
  const usage = record !== undefined && isRecord(record.usage) ? record.usage : undefined;
  const model = stringValue(record?.model) ?? defaultModel;
  const inputTokens = numberValue(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = numberValue(usage?.output_tokens ?? usage?.completion_tokens);
  return {
    model,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function assertPromptSize(prompt: string): void {
  if (Buffer.byteLength(prompt, 'utf8') > 100_000) {
    throw new ReportProviderException('INVALID_OUTPUT');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestUsage(model: string): ReportProviderUsage {
  return { model };
}

async function readJsonBody(response: Response, usage: ReportProviderUsage): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error: unknown) {
    throw new ReportProviderException('UPSTREAM_ERROR', {
      retryable: true,
      resultUncertain: true,
      usage,
      cause: error,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new ReportProviderException('INVALID_OUTPUT', { usage, cause: error });
  }
}
