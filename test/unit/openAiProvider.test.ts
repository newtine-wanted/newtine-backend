import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { PipelineAiConfiguration } from '@newtine/batch/pipeline/pipeline.ai.config.js';
import { OpenAiResponsesClient } from '@newtine/batch/pipeline/openAi.provider.js';
import { PipelineException, PipelineExceptionCode } from '@newtine/core';

test('OpenAI Responses payload uses the stage snapshot and records provider usage metadata', async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: 'response-id',
        status: 'completed',
        model: 'actual-provider-model',
        output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }],
        usage: { input_tokens: 12, output_tokens: 4 },
      }),
      { status: 200, headers: { 'x-request-id': 'header-request-id' } },
    );
  };

  try {
    const configuration = new PipelineAiConfiguration();
    const client = new OpenAiResponsesClient(configuration);
    const result = await client.json<{ ok: boolean }>('content', 'typed-input', {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    });

    assert.deepEqual(result.value, { ok: true });
    assert.equal(result.usage?.model, 'actual-provider-model');
    assert.equal(result.usage?.promptVersion, 'pipeline.content-generation@1.0.0');
    assert.equal(result.usage?.promptHash, configuration.stage('content').prompt?.hash);
    assert.equal(result.usage?.requestId, 'response-id');
    assert.equal(result.usage?.inputTokens, 12);
    assert.equal(result.usage?.outputTokens, 4);

    const text = requestBody?.text as { format: { name: string; schema: Record<string, unknown> } };
    assert.equal(requestBody?.model, 'gpt-5.4-mini-2026-03-17');
    assert.equal(requestBody?.store, false);
    assert.equal(requestBody?.input, 'typed-input');
    assert.equal(text.format.name, 'pipeline_content');
    assert.deepEqual(text.format.schema, {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  }
});

test('OpenAI adapter translates missing credentials into a pipeline exception', async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const client = new OpenAiResponsesClient(new PipelineAiConfiguration());
    await assert.rejects(
      () => client.embedding('입력'),
      (error: unknown) =>
        error instanceof PipelineException &&
        error.domain === 'pipeline' &&
        error.code === PipelineExceptionCode.UpstreamError &&
        error.retryable === false,
    );
  } finally {
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  }
});

test('OpenAI embedding repair can request the model recorded on the task', async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        model: 'recorded-embedding-model',
        data: [{ embedding: [0.1] }],
      }),
      { status: 200, headers: { 'x-request-id': 'embedding-request-id' } },
    );
  };

  try {
    const client = new OpenAiResponsesClient(new PipelineAiConfiguration());
    const result = await client.embedding('repair-input', 'recorded-embedding-model');
    assert.equal(requestBody?.model, 'recorded-embedding-model');
    assert.equal(result.value.model, 'recorded-embedding-model');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  }
});
