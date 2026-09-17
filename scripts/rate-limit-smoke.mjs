/* global clearTimeout, console, fetch, process, setTimeout */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['dist/apps/api/src/main.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '0',
    API_SMOKE_READY: '1',
    RATE_LIMIT_WINDOW_MS: '1000',
    RATE_LIMIT_MAX_REQUESTS: '2',
    RATE_LIMIT_SEARCH_MAX_REQUESTS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});

let output = '';
let baseUrl;
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

const ready = new Promise((resolve, reject) => {
  let settled = false;
  const fail = (error) => {
    if (settled) return;
    settled = true;
    reject(error);
  };

  child.on('message', (message) => {
    if (message?.type !== 'ready' || !Number.isInteger(message.port) || message.port <= 0) {
      return;
    }
    settled = true;
    baseUrl = `http://127.0.0.1:${message.port}`;
    resolve();
  });
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    fail(new Error(`API exited before ready (code=${code}, signal=${signal}).\n${output}`));
  });
});

async function waitForApi() {
  let timeout;
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`API did not become ready.\n${output}`)),
          8_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function stopApi() {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, init);
}

function assertRateLimited(response, body, message) {
  assert.equal(response.status, 429, message);
  assert.match(response.headers.get('content-type') ?? '', /application\/problem\+json/);
  assert.ok(Number(response.headers.get('retry-after')) >= 1);
  assert.deepEqual(body, {
    title: 'Too Many Requests',
    status: 429,
    detail: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    code: 'RATE_LIMITED',
  });
}

try {
  await waitForApi();

  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const firstSearch = await request('/issues/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'rate-limit' }),
  });
  assert.equal(firstSearch.status, 200);

  const endpointRejected = await request('/issues/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.99',
    },
    body: '{malformed',
  });
  assertRateLimited(
    endpointRejected,
    await endpointRejected.json(),
    'endpoint override must reject before the body parser',
  );

  await new Promise((resolve) => setTimeout(resolve, 1_200));

  for (let index = 0; index < 2; index += 1) {
    const missing = await request('/missing');
    assert.equal(missing.status, 404);
  }

  const globalRejected = await request('/issues/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{malformed',
  });
  assertRateLimited(
    globalRejected,
    await globalRejected.json(),
    'global limiter must reject before the body parser',
  );

  const healthAfterRejection = await request('/health');
  assert.equal(healthAfterRejection.status, 200);
  assert.ok(output.includes('"event":"http.rate_limited"'));
  assert.equal(output.includes('203.0.113.99'), false);
  console.log(
    'Rate-limit smoke passed: early global/endpoint 429, forwarded-header isolation, and health bypass',
  );
} finally {
  await stopApi();
}
