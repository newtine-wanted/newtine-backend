import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import type { ReportCandidates, ReportInput } from '@newtine/core/report/report.model.js';
import { ReportAiConfiguration } from '@newtine/batch/report/report.ai.config.js';
import {
  ReportOpenAiProvider,
  ReportOpenAiResponsesClient,
  ReportProviderException,
} from '@newtine/batch/report/report.provider.js';

function configuration(): ReportAiConfiguration {
  return new ReportAiConfiguration({
    REPORT_AI_MODEL: 'report-test-model',
    OPENAI_API_KEY: 'report-test-key',
  });
}

function input(): { input: ReportInput; candidates: ReportCandidates } {
  const source = generateUuidV7();
  const issue = {
    issueId: source,
    title: '관심 이슈',
    categoryCode: 'ECONOMY',
    categoryName: '경제',
    categoryOrder: 1,
    summary: '요약',
    summaryLines: ['요약'],
  };
  return {
    input: {
      version: 1,
      capturedAt: new Date().toISOString(),
      issues: [issue],
      categoryCounts: [{ categoryCode: 'ECONOMY', displayName: '경제', count: 1 }],
      excludedCount: 0,
      hash: 'hash',
    },
    candidates: {
      capturedAt: new Date().toISOString(),
      related: [],
      major: [],
      majorCategoryCodes: [],
      relatedUnavailable: false,
    },
  };
}

function response(value: unknown): Response {
  return new Response(
    JSON.stringify({
      id: 'response-id',
      model: 'actual-report-model',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
      usage: { input_tokens: 12, output_tokens: 7 },
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'header-id' } },
  );
}

test('report provider uses isolated strict JSON Responses payload and stores no request', async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return response({ connections: [], related: [] });
  }) as typeof fetch;
  try {
    const config = configuration();
    const provider = new ReportOpenAiProvider(new ReportOpenAiResponsesClient(config), config);
    const values = input();
    const result = await provider.generate({
      input: values.input,
      candidates: values.candidates,
      allowConnections: false,
    });

    assert.ok('value' in result);
    assert.deepEqual(result.value, { connections: [], related: [] });
    assert.equal(result.usage?.model, 'actual-report-model');
    assert.equal(result.usage?.providerRequestId, 'response-id');
    assert.equal(result.usage?.inputTokens, 12);
    assert.equal(result.usage?.outputTokens, 7);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.store, false);
    assert.equal(requests[0]?.instructions, config.generationPrompt.instruction);
    const messages = requests[0]?.input as Array<{
      role: string;
      content: Array<{ text: string }>;
    }>;
    assert.equal(messages[0]?.role, 'user');
    const data = JSON.parse(messages[0]!.content[0]!.text) as Record<string, unknown>;
    assert.ok('snapshot' in data);
    assert.equal(
      messages[0]!.content[0]!.text.includes(config.generationPrompt.instruction),
      false,
    );
    assert.equal(requests[0]?.model, 'report-test-model');
    assert.equal(requests[0]?.max_output_tokens, 4_000);
    assert.equal('userId' in requests[0]!, false);
    const text = requests[0]?.text as Record<string, unknown>;
    const format = text.format as Record<string, unknown>;
    assert.equal(format.type, 'json_schema');
    assert.equal(format.strict, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('report provider turns malformed upstream JSON into a safe invalid-output error', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{malformed', { status: 200 })) as typeof fetch;
  try {
    const config = configuration();
    const client = new ReportOpenAiResponsesClient(config);
    await assert.rejects(
      client.json('generation', '{}', { type: 'object' }),
      (error: unknown) =>
        error instanceof ReportProviderException && error.code === 'INVALID_OUTPUT',
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('report provider preserves upstream request id on known provider failures', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'x-request-id': 'rate-limit-id' },
    })) as typeof fetch;
  try {
    const config = configuration();
    const client = new ReportOpenAiResponsesClient(config);
    await assert.rejects(
      client.json('generation', '{}', { type: 'object' }),
      (error: unknown) =>
        error instanceof ReportProviderException &&
        error.code === 'UPSTREAM_ERROR' &&
        error.retryable &&
        error.resultUncertain &&
        error.usage?.model === config.model &&
        error.usage.providerRequestId === 'rate-limit-id',
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
