import { newsPrompt } from '../ai/news-prompt.js';
import type { FetchedArticle } from '@newtine/core';
import { DEFAULT_OPENAI_TEXT_MODEL } from '../ai/ai-model.defaults.js';
import {
  GENERATIONS,
  type Catalog,
  type Classification,
  type Draft,
  type GenerationConfig,
  type GenerationModel,
  type TermDefinition,
  type Usage,
} from './generation.types.js';
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const str = { type: 'string', minLength: 1 };
const arr = (items: unknown, maxItems = 100) => ({ type: 'array', items, maxItems });
export class GenerationOpenAiModel implements GenerationModel {
  readonly usage: Usage[] = [];
  constructor(
    private readonly apiKey: string,
    private readonly uxWriting: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  async generate(articles: FetchedArticle[], config: GenerationConfig): Promise<Draft> {
    const refs = arr({ type: 'string', enum: articles.map((a) => a.articleId) }, articles.length);
    return this.json(
      'generate',
      newsPrompt('generation-generate', {
        uxWriting: this.uxWriting,
        maxTrackingDays: config.maxTrackingDays,
      }),
      {
        generations: GENERATIONS,
        articles: articles.map((a) => ({ ...a, body: a.body.slice(0, config.bodyCharacters) })),
      },
      obj({
        title: str,
        eventAt: { type: ['string', 'null'] },
        eventEvidence: { type: ['string', 'null'] },
        integratedSummary: str,
        summaryLines: { ...arr(str, 3), minItems: 3 },
        viewpoints: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: obj({ stakeholder: str, statement: str, articleIds: { ...refs, minItems: 1 } }),
        },
        sharedConditionalImpact: {
          ...obj({ description: str, articleIds: { ...refs, minItems: 1 } }),
          type: ['object', 'null'],
        },
        impacts: {
          ...arr(
            obj({
              generation: { type: 'string', enum: GENERATIONS },
              description: str,
              articleIds: refs,
            }),
            4,
          ),
          minItems: 4,
        },
        generations: arr({ type: 'string', enum: GENERATIONS }, 4),
        llmEstimatedImportance: { type: 'number', minimum: 0, maximum: 1 },
        importanceReason: str,
        terms: arr({ type: 'string', minLength: 1, maxLength: 80 }, 5),
        followUp: obj({
          enabled: { type: 'boolean' },
          days: { type: 'integer', minimum: 0, maximum: config.maxTrackingDays },
          queries: arr({ type: 'string', minLength: 1, maxLength: 200 }, 3),
          reason: str,
        }),
      }),
    );
  }
  async classify(
    draft: Draft,
    articles: FetchedArticle[],
    unresolved: Partial<Catalog>,
  ): Promise<Omit<Classification, 'generations'>> {
    const fields = Object.fromEntries(
      (['topics', 'regions', 'entities'] as const).map((key) => [
        key,
        unresolved[key]?.length
          ? arr({ type: 'string', enum: unresolved[key]!.map((r) => r.code) })
          : { ...arr({ type: 'string' }), maxItems: 0 },
      ]),
    );
    return this.json(
      'classify',
      newsPrompt('generation-classify'),
      {
        title: draft.title,
        summary: draft.integratedSummary,
        articles: articles.map((a) => ({ title: a.title, body: a.body.slice(0, 18000) })),
        allowed: unresolved,
      },
      obj(fields),
    );
  }
  async define(terms: string[], draft: Draft): Promise<TermDefinition[]> {
    if (!terms.length) return [];
    const result = await this.json<{ definitions: { term: string; definition: string }[] }>(
      'define',
      newsPrompt('generation-define', { uxWriting: this.uxWriting }),
      { terms, title: draft.title, summary: draft.integratedSummary },
      obj({
        definitions: {
          ...arr(obj({ term: { type: 'string', enum: terms }, definition: str }), terms.length),
          minItems: terms.length,
        },
      }),
    );
    if (
      !Array.isArray(result.definitions) ||
      result.definitions.length !== terms.length ||
      terms.some((t) => result.definitions.filter((d) => d.term === t).length !== 1) ||
      result.definitions.some((d) => typeof d.definition !== 'string' || !d.definition.trim())
    )
      throw new Error('INVALID_TERM_DEFINITIONS');
    return result.definitions.map((d) => ({ ...d, source: 'GENERATED' }));
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
          format: { type: 'json_schema', name: `news_generation_${stage}`, strict: true, schema },
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
