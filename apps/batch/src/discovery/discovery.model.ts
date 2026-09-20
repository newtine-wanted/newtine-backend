import { newsPrompt } from '../ai/news-prompt.js';
import { DEFAULT_OPENAI_TEXT_MODEL } from '@newtine/batch/ai/ai-model.defaults.js';
import { MAX_CANDIDATES_PER_QUERY, MAX_CANDIDATE_SEARCH_TITLE_LENGTH } from './discovery.policy.js';
import type { DiscoveryModel, DiscoverySnapshot } from './discovery.types.js';

const objectSchema = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const indexesSchema = { type: 'array', items: { type: 'integer', minimum: 0 } };
export const EXTRACTION_INSTRUCTIONS = newsPrompt('discovery-extract');
export class DiscoveryOpenAiModel implements DiscoveryModel {
  excludedCandidates: { index: number; reason: 'IRRELEVANT' | 'HYPERLOCAL' }[] = [];
  readonly usage: DiscoverySnapshot['usage'] = [];
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  async extract(
    titles: string[],
    limit: number,
  ): Promise<{ title: string; titleIndexes: number[]; representativeTitleIndex: number }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CANDIDATES_PER_QUERY)
      throw new Error('INVALID_CANDIDATE_LIMIT');
    const response = await this.json<{
      candidates: { title: string; titleIndexes: number[]; representativeTitleIndex: number }[];
    }>(
      'extract',
      EXTRACTION_INSTRUCTIONS +
        '\n' +
        newsPrompt('discovery-extract-limits', { limit, maxIndex: titles.length - 1 }),
      titles.map((title, index) => ({ index, title })),
      objectSchema({
        candidates: {
          type: 'array',
          maxItems: limit,
          items: objectSchema({
            representativeTitleIndex: { type: 'integer', minimum: 0, maximum: titles.length - 1 },
            title: { type: 'string', minLength: 1, maxLength: MAX_CANDIDATE_SEARCH_TITLE_LENGTH },
            titleIndexes: {
              type: 'array',
              minItems: 1,
              maxItems: titles.length,
              items: { type: 'integer', minimum: 0, maximum: titles.length - 1 },
            },
          }),
        },
      }),
    );
    return response.candidates;
  }
  async groups(titles: string[]): Promise<number[][]> {
    this.excludedCandidates = [];
    if (!titles.length) return [];
    const indexSchema = { type: 'integer', minimum: 0, maximum: titles.length - 1 };
    const response = await this.json<{
      duplicates: { keepIndex: number; duplicateIndexes: number[] }[];
      excluded: { index: number; title: string; reason: 'IRRELEVANT' | 'HYPERLOCAL' }[];
    }>(
      'deduplicate',
      newsPrompt('discovery-finalize'),
      titles.map((title, index) => ({ index, title })),
      objectSchema({
        excluded: {
          type: 'array',
          items: objectSchema({
            index: indexSchema,
            title: { type: 'string' },
            reason: { type: 'string', enum: ['IRRELEVANT', 'HYPERLOCAL'] },
          }),
        },
        duplicates: {
          type: 'array',
          items: objectSchema({
            keepIndex: indexSchema,
            duplicateIndexes: { type: 'array', minItems: 1, items: indexSchema },
          }),
        },
      }),
    );
    if (!Array.isArray(response?.duplicates) || !Array.isArray(response?.excluded))
      throw new Error('INVALID_DUPLICATE_GROUPS');
    const used = new Set<number>();
    const groups: number[][] = [];
    for (const item of response.excluded) {
      if (
        !item ||
        !Number.isSafeInteger(item.index) ||
        item.index < 0 ||
        item.index >= titles.length ||
        used.has(item.index) ||
        item.title !== titles[item.index] ||
        !['IRRELEVANT', 'HYPERLOCAL'].includes(item.reason)
      )
        throw new Error('INVALID_EXCLUDED_CANDIDATE');
      used.add(item.index);
    }
    for (const duplicate of response.duplicates) {
      if (
        !duplicate ||
        !Array.isArray(duplicate.duplicateIndexes) ||
        !duplicate.duplicateIndexes.length
      )
        throw new Error('INVALID_DUPLICATE_GROUPS');
      const group = [duplicate.keepIndex, ...duplicate.duplicateIndexes];
      for (const index of group) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= titles.length || used.has(index))
          throw new Error('INVALID_DUPLICATE_INDEX');
        used.add(index);
      }
      groups.push(group);
    }
    // Omitted candidates are unique, not missing. Preserve them without asking the LLM to repeat them.
    titles.forEach((_, i) => {
      if (!used.has(i)) groups.push([i]);
    });
    this.excludedCandidates = response.excluded;
    return groups.sort((a, b) => Math.min(...a) - Math.min(...b));
  }
  async newDevelopments(knownTitles: string[], titles: string[]): Promise<number[]> {
    const response = await this.json<{ indices: number[] }>(
      'follow_up',
      newsPrompt('discovery-follow-up'),
      { knownTitles, titles },
      objectSchema({
        indices: {
          ...indexesSchema,
          items: { type: 'integer', minimum: 0, maximum: titles.length - 1 },
        },
      }),
    );
    return response.indices;
  }
  private async json<T>(
    stage: string,
    instructions: string,
    input: unknown,
    schema: Record<string, unknown>,
  ): Promise<T> {
    if (!this.apiKey.trim()) throw new Error('OPENAI_KEY_MISSING');
    // Deliberately separate instructions from untrusted title data. No article URLs, dates, descriptions or bodies.
    const response = await this.request('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_OPENAI_TEXT_MODEL,
        store: false,
        instructions,
        input: JSON.stringify(input),
        max_output_tokens: 16000,
        text: {
          format: { type: 'json_schema', name: `news_discovery_${stage}`, strict: true, schema },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
    const body = (await response.json()) as {
      status?: string;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    this.usage.push({
      stage,
      model: DEFAULT_OPENAI_TEXT_MODEL,
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
    });
    if (body.status !== 'completed' || !Array.isArray(body.output))
      throw new Error('OPENAI_INCOMPLETE_OUTPUT');
    const parts = body.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
    if (parts.some((p) => p.type === 'refusal')) throw new Error('OPENAI_REFUSED');
    const text = parts
      .filter((p) => p.type === 'output_text')
      .map((p) => p.text ?? '')
      .join('');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('OPENAI_INVALID_JSON');
    }
  }
}
