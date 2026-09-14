import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@jest/globals';

import { normalizeOpenApiDocument, PROBLEM_DETAILS_REF } from '../../scripts/openapi.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const generatedRoot = join(root, 'generated');
const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);
const EXPECTED_FAILURE_STATUSES = {
  '/issues/search': ['400', '413', '500'],
  '/health': ['500'],
  '/onboarding/options': ['500'],
  '/onboarding/entities': ['400', '500'],
  '/me/onboarding': ['401', '500'],
  '/me/onboarding/complete': ['400', '401', '500'],
  '/me/onboarding/skip': ['401', '500'],
  '/pipeline/runs': ['400', '409', '500'],
  '/pipeline/runs/{runId}': ['400', '404', '500'],
  '/pipeline/runs/{runId}/retry': ['400', '404', '409', '500'],
  '/pipeline/runs/{runId}/interrupt': ['400', '404', '409', '500'],
};
const requiredFiles = [
  'api/index.ts',
  'e2e/features/api/automated/test_api_health_getHealth.ts',
  'e2e/features/api/automated/test_api_issues_search.ts',
  'api/functional/me/index.ts',
  'api/functional/me/onboarding/index.ts',
  'api/functional/onboarding/index.ts',
  'api/functional/onboarding/entities/index.ts',
  'api/functional/onboarding/options/index.ts',
  'e2e/features/api/automated/test_api_me_onboarding_complete.ts',
  'e2e/features/api/automated/test_api_me_onboarding_getMyOnboarding.ts',
  'e2e/features/api/automated/test_api_me_onboarding_skip.ts',
  'e2e/features/api/automated/test_api_onboarding_entities_searchEntities.ts',
  'e2e/features/api/automated/test_api_onboarding_options_getOptions.ts',
  'api/functional/pipeline/runs/index.ts',
  'e2e/features/api/automated/test_api_pipeline_runs_create.ts',
  'e2e/features/api/automated/test_api_pipeline_runs_get.ts',
  'e2e/features/api/automated/test_api_pipeline_runs_interrupt.ts',
  'e2e/features/api/automated/test_api_pipeline_runs_retry.ts',
  'openapi.json',
];

test('Nestia emits the required contract artifacts', async () => {
  await Promise.all(requiredFiles.map((file) => access(join(generatedRoot, file))));
});

test('generated OpenAPI describes RFC 9457 failure responses', async () => {
  const document = JSON.parse(await readFile(join(generatedRoot, 'openapi.json'), 'utf8'));

  assert.equal(document.openapi, '3.1.0');
  assert.deepEqual(document.servers, [{ url: '/', description: 'Current API origin' }]);

  const schemas = document.components?.schemas;
  const problemDetails = schemas?.ProblemDetails;
  assert.ok(problemDetails, 'ProblemDetails schema is required');

  const pipelineCreate = schemas?.PipelineRunCreateRequest;
  assert.deepEqual(Object.keys(pipelineCreate?.properties ?? {}), ['query']);
  assert.equal(schemas?.PipelineRunLimitsRequest, undefined);

  const retrySchema =
    document.paths?.['/pipeline/runs/{runId}/retry']?.post?.requestBody?.content?.[
      'application/json'
    ]?.schema;
  assert.deepEqual(retrySchema?.discriminator?.propertyName, 'scope');
  const contentSchemaName = retrySchema?.discriminator?.mapping?.CONTENT?.split('/').pop();
  const discoverySchemaName = retrySchema?.discriminator?.mapping?.DISCOVERY?.split('/').pop();
  assert.ok(contentSchemaName && discoverySchemaName);
  assert.ok(schemas?.[contentSchemaName]?.required?.includes('failedJobIds'));
  assert.equal(schemas?.[discoverySchemaName]?.required?.includes('failedJobIds'), false);

  assert.deepEqual(Object.keys(problemDetails.properties ?? {}).sort(), [
    'code',
    'detail',
    'status',
    'title',
  ]);
  assert.deepEqual([...problemDetails.required].sort(), ['code', 'detail', 'status', 'title']);

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue;

      const failureStatuses = Object.keys(operation.responses ?? {}).filter((status) =>
        /^(?:[45]XX|[45]\d\d)$/.test(status),
      );
      assert.deepEqual(
        failureStatuses.sort(),
        [...(EXPECTED_FAILURE_STATUSES[path] ?? [])].sort(),
        `${method.toUpperCase()} ${path} must declare only its supported failure statuses`,
      );

      for (const status of EXPECTED_FAILURE_STATUSES[path] ?? []) {
        const response = operation.responses?.[status];
        const content = response?.content?.['application/problem+json'];
        assert.equal(
          content?.schema?.$ref,
          PROBLEM_DETAILS_REF,
          `${method.toUpperCase()} ${path} must declare ${status} ProblemDetails`,
        );
        assert.equal(
          response.content['application/json'],
          undefined,
          `${method.toUpperCase()} ${path} ${status} must not retain application/json`,
        );
      }
    }
  }
});

test('OpenAPI normalizer preserves response metadata and is idempotent', () => {
  const document = {
    paths: {
      '/fixture': {
        post: {
          responses: {
            200: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Success' } },
              },
            },
            400: {
              description: 'Invalid request',
              headers: { 'x-request-id': { schema: { type: 'string' } } },
              content: {
                'application/json': {
                  schema: { $ref: PROBLEM_DETAILS_REF },
                  examples: { invalid: { value: { code: 'INVALID_ARGUMENT' } } },
                },
              },
            },
          },
        },
      },
    },
  };

  normalizeOpenApiDocument(document);
  const response = document.paths['/fixture'].post.responses['400'];
  assert.deepEqual(response.content['application/problem+json'], {
    schema: { $ref: PROBLEM_DETAILS_REF },
    examples: { invalid: { value: { code: 'INVALID_ARGUMENT' } } },
  });
  assert.equal(response.content['application/json'], undefined);
  assert.equal(response.description, 'Invalid request');
  assert.deepEqual(response.headers, { 'x-request-id': { schema: { type: 'string' } } });
  assert.ok(document.paths['/fixture'].post.responses['200'].content['application/json']);

  const normalized = JSON.stringify(document);
  normalizeOpenApiDocument(document);
  assert.equal(JSON.stringify(document), normalized);
});

test('OpenAPI normalizer rejects conflicting ProblemDetails media objects', () => {
  assert.throws(
    () =>
      normalizeOpenApiDocument({
        paths: {
          '/fixture': {
            get: {
              responses: {
                500: {
                  content: {
                    'application/json': { schema: { $ref: PROBLEM_DETAILS_REF } },
                    'application/problem+json': {
                      schema: { $ref: PROBLEM_DETAILS_REF },
                      example: { code: 'DIFFERENT' },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    /conflicting application\/json and application\/problem\+json/,
  );
});
