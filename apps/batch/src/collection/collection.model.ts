import { newsPrompt } from '../ai/news-prompt.js';
import { configuredNewsTextModel } from '@newtine/batch/ai/ai-model.defaults.js';
import type { DiscoveredArticle } from '@newtine/core';
import type { Candidate, DiscoverySnapshot } from '../discovery/discovery.types.js';
import { checkedIndexes } from '../discovery/discovery.policy.js';
import type { CollectionModel, SimilarIssue } from './collection.types.js';

export class CollectionOpenAiModel implements CollectionModel {
  readonly usage: DiscoverySnapshot['usage'] = [];
  private readonly model = configuredNewsTextModel();
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  async duplicates(candidate: Candidate, issues: SimilarIssue[]): Promise<number[]> {
    if (!issues.length) return [];
    return this.indices(
      'duplicates',
      newsPrompt('collection-duplicates'),
      {
        candidate: candidate.title,
        evidenceTitles: candidate.articles.map((a) => a.title),
        existingIssues: issues.map((i, index) => ({ index, title: i.title })),
      },
      issues.length,
    );
  }
  async relevant(candidate: Candidate, articles: DiscoveredArticle[]): Promise<number[]> {
    if (!articles.length) return [];
    const representative = candidate.representativeArticle ?? candidate.articles[0];
    if (!representative?.title?.trim()) throw new Error('REPRESENTATIVE_ARTICLE_REQUIRED');
    return this.indices(
      'relevant',
      newsPrompt('collection-relevant'),
      {
        candidate: candidate.title,
        representativeArticleTitle: representative.title,
        articles: articles.map((a, index) => ({
          index,
          title: a.title,
          description: a.description,
        })),
      },
      articles.length,
    );
  }
  private async indices(
    stage: string,
    instructions: string,
    input: unknown,
    length: number,
  ): Promise<number[]> {
    if (!this.apiKey.trim()) throw new Error('OPENAI_KEY_MISSING');
    const response = await this.request('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions,
        input: JSON.stringify(input),
        max_output_tokens: 2000,
        text: {
          format: {
            type: 'json_schema',
            name: `news_collection_${stage}`,
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['indices'],
              properties: {
                indices: {
                  type: 'array',
                  maxItems: length,
                  items: { type: 'integer', minimum: 0, maximum: length - 1 },
                },
              },
            },
          },
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
      model: this.model,
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
    });
    if (body.status !== 'completed' || !Array.isArray(body.output))
      throw new Error('OPENAI_INCOMPLETE_OUTPUT');
    const parts = body.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
    if (parts.some((p) => p.type === 'refusal')) throw new Error('OPENAI_REFUSED');
    let parsed: { indices: number[] };
    try {
      parsed = JSON.parse(
        parts
          .filter((p) => p.type === 'output_text')
          .map((p) => p.text ?? '')
          .join(''),
      ) as { indices: number[] };
    } catch {
      throw new Error('OPENAI_INVALID_JSON');
    }
    // Repeating a valid reference does not add evidence; preserve it only once.
    const indices = Array.isArray(parsed?.indices) ? [...new Set(parsed.indices)] : parsed?.indices;
    return checkedIndexes(indices, length, true);
  }
}
