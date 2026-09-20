import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import {
  configuredNewsTextModel,
  DEFAULT_OPENAI_TEXT_MODEL,
} from '@newtine/batch/ai/ai-model.defaults.js';
import { DiscoveryOpenAiModel } from '@newtine/batch/discovery/discovery.model.js';
import { CollectionOpenAiModel } from '@newtine/batch/collection/collection.model.js';
import { GenerationOpenAiModel } from '@newtine/batch/generation/generation.model.js';
import { ValidationOpenAiModel } from '@newtine/batch/validation/validation.model.js';
import type { ValidationSnapshot } from '@newtine/batch/validation/validation.types.js';
import type { GenerationResult } from '@newtine/batch/generation/generation.types.js';

test('news text model defaults and environment override', () => {
  assert.equal(configuredNewsTextModel({}), DEFAULT_OPENAI_TEXT_MODEL);
  assert.equal(configuredNewsTextModel({ PIPELINE_AI_MODEL: '  ' }), DEFAULT_OPENAI_TEXT_MODEL);
  assert.equal(configuredNewsTextModel({ PIPELINE_AI_MODEL: ' test-model ' }), 'test-model');
});
test('all standalone model adapters use override in requests and usage', async () => {
  const previous = process.env.PIPELINE_AI_MODEL;
  process.env.PIPELINE_AI_MODEL = 'test-model';
  const requests: Record<string, unknown>[] = [];
  const response = (value: unknown) =>
    (async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 1 },
          output: [
            { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
          ],
        }),
      );
    }) as typeof fetch;
  try {
    const discovery = new DiscoveryOpenAiModel('test', response({ candidates: [] }));
    const collection = new CollectionOpenAiModel('test', response({ indices: [] }));
    const generation = new GenerationOpenAiModel('test', 'guide', response({}));
    const validation = new ValidationOpenAiModel('test', response({ findings: [] }));
    await discovery.extract(['기사 제목'], 1);
    await collection.relevant(
      { title: '후보', articles: [{ title: '대표 제목' }] } as Parameters<
        typeof collection.relevant
      >[0],
      [{ title: '대표 제목', description: '' }] as Parameters<typeof collection.relevant>[1],
    );
    await generation.generate([], {
      bodyCharacters: 1000,
      maxTrackingDays: 30,
      freshnessHalfLifeHours: 72,
    });
    await validation.review(
      { draft: {}, glossary: [] } as unknown as GenerationResult,
      {} as ValidationSnapshot,
    );
    assert.equal(requests.length, 4);
    assert.ok(requests.every((r) => r.model === 'test-model'));
    assert.ok(
      [discovery, collection, generation, validation].every(
        (m) => m.usage[0]?.model === 'test-model',
      ),
    );
  } finally {
    if (previous === undefined) delete process.env.PIPELINE_AI_MODEL;
    else process.env.PIPELINE_AI_MODEL = previous;
  }
});
