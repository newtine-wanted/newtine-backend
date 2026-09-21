import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@jest/globals';

import {
  API_PREFIX,
  normalizeOpenApiDocument,
  PROBLEM_DETAILS_REF,
} from '../../scripts/openapi.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const generatedRoot = join(root, 'generated');
const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);
const apiPath = (path) => `${API_PREFIX}${path}`;
const GENERATED_PATH_COMMENT = /@path\s+\S+\s+(\/\S+)/g;
const ROOT_PATH_LITERAL = /(["'`])\/(?!api(?:\/|["'`]))/;
const EXPECTED_FAILURE_STATUSES = {
  '/issues/search': ['400', '413', '500'],
  '/issues/{issueId}': ['400', '401', '404', '503'],
  '/issues/{issueId}/interactions': ['400', '401', '404', '409', '503'],
  '/issues/{issueId}/detail-views/{viewId}': ['400', '401', '404', '409', '503'],
  '/issues/{issueId}/detail-views/{viewId}/progress': ['400', '401', '404', '409', '410', '503'],
  '/feed': ['400', '401', '404', '409', '410', '503'],
  '/health': ['500'],
  '/metadata/categories': ['500'],
  '/metadata/age-groups': ['500'],
  '/metadata/regions': ['500'],
  '/metadata/political-actors': ['400', '500'],
  '/me/onboarding': ['401', '500'],
  '/me/interest-analysis': ['401', '500'],
  '/me/liked-issues': ['400', '401', '500'],
  'get /me/reports': ['401', '500'],
  'post /me/reports': ['400', '401', '404', '429', '500', '503'],
  '/me/reports/{reportId}': ['400', '401', '404', '500'],
  '/me/reports/{reportId}/retry': ['400', '401', '404', '409', '429', '500'],
  '/me/onboarding/complete': ['400', '401', '500'],
  '/me/onboarding/skip': ['401', '500'],
  '/pipeline/runs': ['400', '401', '403', '409', '500'],
  '/pipeline/runs/{runId}': ['400', '401', '403', '404', '500'],
  '/pipeline/runs/{runId}/retry': ['400', '401', '403', '404', '409', '500'],
  '/pipeline/runs/{runId}/interrupt': ['400', '401', '403', '404', '409', '500'],
  '/auth/signup': ['400', '403', '409', '500'],
  '/auth/login': ['400', '401', '403', '500'],
  '/auth/refresh': ['401', '403', '500'],
  '/auth/logout': ['403', '500'],
  '/auth/withdraw': ['400', '401', '403', '429', '503', '500'],
};
const EXPECTED_SUCCESS_STATUSES = {
  '/issues/{issueId}/interactions': '200',
  '/issues/{issueId}/detail-views/{viewId}': ['200', '201'],
  '/issues/{issueId}/detail-views/{viewId}/progress': '200',
  '/auth/signup': '201',
  '/auth/login': '200',
  '/auth/refresh': '200',
  '/auth/logout': '204',
  '/auth/withdraw': '204',
};
const requiredFiles = [
  'api/index.ts',
  'api/functional/auth/index.ts',
  'e2e/features/api/automated/test_api_health_getHealth.ts',
  'e2e/features/api/automated/test_api_auth_signup.ts',
  'e2e/features/api/automated/test_api_issues_search.ts',
  'api/functional/issues/interactions/index.ts',
  'api/functional/issues/detail_views/index.ts',
  'api/functional/issues/detail_views/progress/index.ts',
  'e2e/features/api/automated/test_api_issues_interactions_recordInteraction.ts',
  'e2e/features/api/automated/test_api_issues_detail_views_startDetailView.ts',
  'e2e/features/api/automated/test_api_issues_detail_views_progress_updateDetailView.ts',
  'api/functional/feed/index.ts',
  'e2e/features/api/automated/test_api_feed_getFeed.ts',
  'api/functional/me/index.ts',
  'api/functional/me/interest_analysis/index.ts',
  'api/functional/me/liked_issues/index.ts',
  'api/functional/me/onboarding/index.ts',
  'api/functional/metadata/index.ts',
  'api/functional/metadata/age_groups/index.ts',
  'api/functional/metadata/categories/index.ts',
  'api/functional/metadata/political_actors/index.ts',
  'api/functional/metadata/regions/index.ts',
  'e2e/features/api/automated/test_api_me_onboarding_complete.ts',
  'e2e/features/api/automated/test_api_me_onboarding_getMyOnboarding.ts',
  'e2e/features/api/automated/test_api_me_onboarding_skip.ts',
  'e2e/features/api/automated/test_api_me_interest_analysis_getAnalysis.ts',
  'e2e/features/api/automated/test_api_me_liked_issues_getLikedIssues.ts',
  'e2e/features/api/automated/test_api_metadata_age_groups_getAgeGroups.ts',
  'e2e/features/api/automated/test_api_metadata_categories_getCategories.ts',
  'e2e/features/api/automated/test_api_metadata_political_actors_searchPoliticalActors.ts',
  'e2e/features/api/automated/test_api_metadata_regions_getRegions.ts',
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

test('generated SDK route metadata and path literals use the API prefix', async () => {
  async function collectTypeScriptFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await collectTypeScriptFiles(file)));
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(file);
    }
    return files;
  }

  const files = await collectTypeScriptFiles(join(generatedRoot, 'api'));
  let routeCommentCount = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(GENERATED_PATH_COMMENT)) {
      routeCommentCount += 1;
      assert.equal(
        match[1] === API_PREFIX || match[1].startsWith(`${API_PREFIX}/`),
        true,
        `${file} has an unprefixed generated route comment: ${match[1]}`,
      );
    }
    assert.equal(
      ROOT_PATH_LITERAL.test(source),
      false,
      `${file} contains a root path literal that is not under ${API_PREFIX}`,
    );
  }
  assert.ok(routeCommentCount > 0, 'generated SDK route comments must be present');
});

test('generated OpenAPI describes RFC 9457 failure responses', async () => {
  const document = JSON.parse(await readFile(join(generatedRoot, 'openapi.json'), 'utf8'));

  assert.equal(document.openapi, '3.1.0');
  assert.deepEqual(document.servers, [{ url: '/', description: 'Current API origin' }]);
  assert.ok(Object.keys(document.paths ?? {}).length > 0);
  for (const path of Object.keys(document.paths ?? {})) {
    assert.equal(
      path === API_PREFIX || path.startsWith(`${API_PREFIX}/`),
      true,
      `${path} must use ${API_PREFIX}`,
    );
  }
  for (const removedPath of ['/onboarding/options', '/onboarding/entities']) {
    assert.equal(
      document.paths?.[apiPath(removedPath)],
      undefined,
      `${removedPath} must remain removed from the generated contract`,
    );
  }

  const schemas = document.components?.schemas;
  const problemDetails = schemas?.ProblemDetails;
  assert.ok(problemDetails, 'ProblemDetails schema is required');

  const pipelineCreate = schemas?.PipelineRunCreateRequest;
  assert.deepEqual(Object.keys(pipelineCreate?.properties ?? {}), ['query']);
  assert.equal(schemas?.PipelineRunLimitsRequest, undefined);
  assert.deepEqual(schemas?.AuthCredentialsRequest?.properties?.password, {
    type: 'string',
    minLength: 8,
    maxLength: 128,
  });

  for (const path of [
    '/auth/signup',
    '/auth/login',
    '/auth/refresh',
    '/auth/logout',
    '/auth/withdraw',
  ]) {
    assert.deepEqual(
      document.paths?.[apiPath(path)]?.post?.parameters,
      [
        {
          name: 'origin',
          in: 'header',
          schema: { type: 'string' },
          required: false,
          description: 'Browser Origin; omission is rejected with 403 by the route guard.',
        },
      ],
      `${path} must document the browser Origin header`,
    );
  }

  const retrySchema =
    document.paths?.[apiPath('/pipeline/runs/{runId}/retry')]?.post?.requestBody?.content?.[
      'application/json'
    ]?.schema;
  assert.deepEqual(retrySchema?.discriminator?.propertyName, 'scope');
  const contentSchemaName = retrySchema?.discriminator?.mapping?.CONTENT?.split('/').pop();
  const discoverySchemaName = retrySchema?.discriminator?.mapping?.DISCOVERY?.split('/').pop();
  assert.ok(contentSchemaName && discoverySchemaName);
  assert.ok(schemas?.[contentSchemaName]?.required?.includes('failedJobIds'));
  assert.equal(schemas?.[discoverySchemaName]?.required?.includes('failedJobIds'), false);
  assert.equal(schemas?.[contentSchemaName]?.properties?.failedJobIds?.maxItems, 100);
  assert.equal(schemas?.[discoverySchemaName]?.properties?.failedJobIds?.maxItems, 100);

  assert.deepEqual(Object.keys(problemDetails.properties ?? {}).sort(), [
    'code',
    'detail',
    'status',
    'title',
  ]);
  assert.deepEqual([...problemDetails.required].sort(), ['code', 'detail', 'status', 'title']);

  for (const path of [
    '/me/onboarding',
    '/me/onboarding/complete',
    '/me/onboarding/skip',
    '/me/interest-analysis',
    '/me/liked-issues',
  ]) {
    const operation = Object.values(document.paths[apiPath(path)] ?? {}).find(
      (value) => value && typeof value === 'object' && 'security' in value,
    );
    assert.deepEqual(operation?.security, [{ bearerAuth: [] }], `${path} must require bearerAuth`);
  }

  for (const path of [
    '/pipeline/runs',
    '/pipeline/runs/{runId}',
    '/pipeline/runs/{runId}/retry',
    '/pipeline/runs/{runId}/interrupt',
  ]) {
    const operation = Object.values(document.paths[apiPath(path)] ?? {}).find(
      (value) => value && typeof value === 'object' && 'security' in value,
    );
    assert.deepEqual(operation?.security, [{ bearerAuth: [] }], `${path} must require bearerAuth`);
  }

  const feed = document.paths?.[apiPath('/feed')]?.get;
  assert.deepEqual(feed?.security, [{ bearerAuth: [] }, { guestFeedCookie: [] }, {}]);
  assert.deepEqual(feed?.parameters, [
    {
      name: 'cursor',
      in: 'query',
      schema: { type: 'string' },
      required: false,
    },
  ]);
  assert.deepEqual(schemas?.FeedRequest?.properties?.cursor, {
    type: 'string',
    minLength: 1,
    maxLength: 4096,
  });
  assert.deepEqual(Object.keys(schemas?.FeedResponse?.properties ?? {}).sort(), [
    'continuation',
    'items',
    'nextCursor',
  ]);

  const publicDetail = document.paths?.[apiPath('/issues/{issueId}')]?.get;
  assert.deepEqual(publicDetail?.security, [{ bearerAuth: [] }, {}]);

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue;

      const relativePath = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) : path;

      const failureStatuses = Object.keys(operation.responses ?? {}).filter((status) =>
        /^(?:[45]XX|[45]\d\d)$/.test(status),
      );
      assert.deepEqual(
        failureStatuses.sort(),
        [
          ...(EXPECTED_FAILURE_STATUSES[`${method} ${relativePath}`] ??
            EXPECTED_FAILURE_STATUSES[relativePath] ??
            []),
        ].sort(),
        `${method.toUpperCase()} ${path} must declare only its supported failure statuses`,
      );

      const successStatuses = Object.keys(operation.responses ?? {}).filter((status) =>
        /^2\d\d$/.test(status),
      );
      if (EXPECTED_SUCCESS_STATUSES[relativePath] !== undefined) {
        const expectedSuccessStatuses = Array.isArray(EXPECTED_SUCCESS_STATUSES[relativePath])
          ? EXPECTED_SUCCESS_STATUSES[relativePath]
          : [EXPECTED_SUCCESS_STATUSES[relativePath]];
        assert.deepEqual(
          successStatuses.sort(),
          expectedSuccessStatuses.sort(),
          `${method.toUpperCase()} ${path} must declare its approved success status`,
        );
      }

      for (const status of EXPECTED_FAILURE_STATUSES[`${method} ${relativePath}`] ??
        EXPECTED_FAILURE_STATUSES[relativePath] ??
        []) {
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
      [apiPath('/issues/{issueId}/detail-views/{viewId}')]: {
        put: {
          responses: {
            201: {
              description: 'Created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DetailViewStartResponse' },
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
  assert.equal(
    document.paths[apiPath('/issues/{issueId}/detail-views/{viewId}')].put.responses['200']
      .description,
    'The detail view already existed and the request was replayed.',
  );
  assert.ok(
    document.paths[apiPath('/issues/{issueId}/detail-views/{viewId}')].put.responses['200'].content[
      'application/json'
    ],
  );

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

test('report contracts expose async request/replay and never worker-private data', async () => {
  const document = JSON.parse(await readFile(join(generatedRoot, 'openapi.json'), 'utf8'));
  for (const [path, methods] of Object.entries({
    '/me/reports': ['get', 'post'],
    '/me/reports/{reportId}': ['get'],
    '/me/reports/{reportId}/retry': ['post'],
  })) {
    for (const method of methods)
      assert.deepEqual(document.paths[apiPath(path)][method].security, [{ bearerAuth: [] }]);
  }
  assert.ok(document.paths[apiPath('/me/reports')].post.responses['200']);
  assert.ok(document.paths[apiPath('/me/reports')].post.responses['202']);
  for (const schema of ['ReportResponse', 'ReportSummaryResponse']) {
    const properties = document.components.schemas[schema].properties;
    for (const key of ['userId', 'input', 'candidates', 'attempt', 'leaseToken', 'leaseExpiresAt'])
      assert.equal(properties[key], undefined);
  }
  assert.deepEqual(Object.keys(document.components.schemas.ReportRequest.properties), [
    'periodStart',
  ]);
  assert.equal(
    document.paths[apiPath('/me/reports/{reportId}/retry')].post.responses['429'].content[
      'application/problem+json'
    ].schema.$ref,
    PROBLEM_DETAILS_REF,
  );
});
