import { newsPrompt } from '../ai/news-prompt.js';
import { DEFAULT_OPENAI_TEXT_MODEL } from '../ai/ai-model.defaults.js';
import type { GenerationResult, Usage } from '../generation/generation.types.js';
import {
  FIELDS,
  type Field,
  type Finding,
  type Patch,
  type Review,
  type ValidationModel,
  type ValidationSnapshot,
} from './validation.types.js';
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
export class ValidationOpenAiModel implements ValidationModel {
  readonly usage: Usage[] = [];
  constructor(
    private readonly apiKey: string,
    private readonly uxWriting: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  private input(result: GenerationResult, context: ValidationSnapshot) {
    return {
      draft: {
        ...result.draft,
        eventAt: result.eventAtSource === 'ARTICLE_EVENT' ? result.draft?.eventAt : null,
        eventEvidence:
          result.eventAtSource === 'ARTICLE_EVENT' ? result.draft?.eventEvidence : null,
      },
      classification: result.classification,
      glossary: result.glossary,
      computed: {
        eventAt: result.eventAt,
        eventAtSource: result.eventAtSource,
        scores: result.scores,
      },
      generationAt: context.generationAt,
      catalog: context.catalog,
      articles: result.articles.map((a) => ({
        articleId: a.articleId,
        title: a.title,
        publishedAt: a.publishedAt,
        body: a.body.slice(0, context.config.bodyCharacters),
      })),
    };
  }
  async review(result: GenerationResult, context: ValidationSnapshot): Promise<Review> {
    return this.json(
      'review',
      newsPrompt('validation-review', { uxWriting: this.uxWriting }),
      this.input(result, context),
      obj({
        findings: {
          type: 'array',
          maxItems: 30,
          items: obj({
            field: { type: 'string', enum: [...FIELDS, 'source', 'scores'] },
            category: { type: 'string', enum: ['FACT', 'CONSISTENCY', 'UX'] },
            reason: { type: 'string', minLength: 1 },
            articleIds: {
              type: 'array',
              items: { type: 'string', enum: result.articles.map((a) => a.articleId) },
            },
          }),
        },
      }),
    );
  }
  async repair(
    result: GenerationResult,
    findings: Finding[],
    fields: Field[],
    context: ValidationSnapshot,
  ): Promise<Patch[]> {
    const value = await this.json<{ patches: { field: Field; valueJson: string }[] }>(
      'repair',
      newsPrompt('validation-repair', {
        uxWriting: this.uxWriting,
        maxTrackingDays: context.config.maxTrackingDays,
      }),
      { ...this.input(result, context), findings, allowedFields: fields },
      obj({
        patches: {
          type: 'array',
          minItems: fields.length,
          maxItems: fields.length,
          items: obj({ field: { type: 'string', enum: fields }, valueJson: { type: 'string' } }),
        },
      }),
    );
    // Malformed repair is a consumed repair attempt; service records HELD rather than retrying content.
    if (!Array.isArray(value?.patches)) return [];
    return value.patches.map((p) => {
      try {
        return { field: p.field, value: JSON.parse(p.valueJson) as unknown };
      } catch {
        return { field: p.field, value: undefined };
      }
    });
  }
  private async json<T>(
    stage: string,
    instructions: string,
    input: unknown,
    schema: unknown,
  ): Promise<T> {
    if (!this.apiKey.trim()) throw new Error('OPENAI_KEY_MISSING');
    const response = await this.request('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_OPENAI_TEXT_MODEL,
        store: false,
        instructions,
        input: JSON.stringify(input),
        max_output_tokens: 6000,
        text: {
          format: { type: 'json_schema', name: `news_validation_${stage}`, strict: true, schema },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
    const body = (await response.json()) as {
      status?: string;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
    };
    this.usage.push({
      stage,
      model: DEFAULT_OPENAI_TEXT_MODEL,
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
      cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens,
    });
    if (body.status !== 'completed' || !Array.isArray(body.output))
      throw new Error('OPENAI_INCOMPLETE_OUTPUT');
    const parts = body.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
    if (parts.some((p) => p.type === 'refusal')) throw new Error('OPENAI_REFUSED');
    try {
      return JSON.parse(
        parts
          .filter((p) => p.type === 'output_text')
          .map((p) => p.text ?? '')
          .join(''),
      ) as T;
    } catch {
      throw new Error('OPENAI_INVALID_JSON');
    }
  }
}
