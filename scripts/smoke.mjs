/* global Buffer, clearTimeout, console, process, setTimeout */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const configuredPort = Number(process.env.API_PORT ?? 0);
const host = process.env.API_HOST ?? '127.0.0.1';
const child = spawn(process.execPath, ['dist/apps/api/src/main.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_PORT: String(configuredPort),
    API_HOST: host,
    API_SMOKE_READY: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});

let output = '';
let apiPort;
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
    apiPort = message.port;
    resolve(message.port);
  });
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    fail(new Error(`API exited before ready (code=${code}, signal=${signal}).\n${output}`));
  });
});

function get(path) {
  return new Promise((resolve, reject) => {
    if (!apiPort) {
      reject(new Error('API port is not known yet'));
      return;
    }

    const req = request({ host, port: apiPort, path, method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ response, body }));
    });
    req.setTimeout(2_000, () => req.destroy(new Error(`GET ${path} timed out`)));
    req.on('error', reject);
    req.end();
  });
}

function postJson(path, payload) {
  return postRawJson(path, JSON.stringify(payload));
}

function postRawJson(path, body) {
  return new Promise((resolve, reject) => {
    if (!apiPort) {
      reject(new Error('API port is not known yet'));
      return;
    }

    const req = request(
      {
        host,
        port: apiPort,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => resolve({ response, body: responseBody }));
      },
    );
    req.setTimeout(2_000, () => req.destroy(new Error(`POST ${path} timed out`)));
    req.on('error', reject);
    req.end(body);
  });
}

async function waitForApi() {
  let timeout;
  try {
    await Promise.race([
      ready,
      new Promise(
        (_, reject) =>
          (timeout = setTimeout(
            () => reject(new Error(`API did not become ready.\n${output}`)),
            8_000,
          )),
      ),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API exited while waiting for health.\n${output}`);
    }

    try {
      const health = await get('/health');
      if (health.response.statusCode === 200) return health;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`API did not start.\n${output}`);
}

async function stopApi() {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

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

try {
  const health = await waitForApi();
  assert.equal(health.response.statusCode, 200);
  assert.equal(health.response.headers['content-type']?.split(';')[0], 'application/json');
  assert.deepEqual(JSON.parse(health.body), { status: 'ok' });
  assert.match(
    health.response.headers['x-request-id'] ?? '',
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  const search = await postJson('/issues/search', { query: '파일럿', limit: 1 });
  assert.equal(search.response.statusCode, 200);
  assert.equal(search.response.headers['content-type']?.split(';')[0], 'application/json');
  const searchBody = JSON.parse(search.body);
  assert.equal(searchBody.query, '파일럿');
  assert.ok(Array.isArray(searchBody.items));

  const invalidSearch = await postJson('/issues/search', { query: '', unexpected: true });
  assert.equal(invalidSearch.response.statusCode, 400);
  assert.equal(
    invalidSearch.response.headers['content-type']?.split(';')[0],
    'application/problem+json',
  );
  const invalidProblem = JSON.parse(invalidSearch.body);
  assert.deepEqual(Object.keys(invalidProblem).sort(), ['code', 'detail', 'status', 'title']);
  assert.equal(invalidProblem.code, 'INVALID_ARGUMENT');
  assert.equal(invalidProblem.detail, '요청 값이 올바르지 않습니다.');
  assert.match(
    invalidSearch.response.headers['x-request-id'] ?? '',
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  const missing = await get('/missing');
  assert.equal(missing.response.statusCode, 404);
  assert.equal(missing.response.headers['content-type']?.split(';')[0], 'application/problem+json');
  const problem = JSON.parse(missing.body);
  assert.deepEqual(Object.keys(problem).sort(), ['code', 'detail', 'status', 'title']);
  assert.equal(problem.status, 404);
  assert.equal(problem.code, 'NOT_FOUND');
  assert.match(
    missing.response.headers['x-request-id'] ?? '',
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  const malformed = await postRawJson(
    '/issues/search',
    '{"private":"parser-secret-sentinel",oops}',
  );
  const oversized = await postJson('/issues/search', { query: 'x'.repeat(110_000) });
  const parserIds = [];
  for (const [result, status, code, title, detail] of [
    [malformed, 400, 'INVALID_ARGUMENT', 'Bad Request', '요청 JSON 형식이 올바르지 않습니다.'],
    [
      oversized,
      413,
      'HTTP_413',
      'Payload Too Large',
      '요청 본문의 크기가 허용 한도를 초과했습니다.',
    ],
  ]) {
    assert.equal(result.response.statusCode, status);
    assert.equal(
      result.response.headers['content-type']?.split(';')[0],
      'application/problem+json',
    );
    assert.deepEqual(JSON.parse(result.body), { title, status, detail, code });
    const requestId = result.response.headers['x-request-id'];
    assert.match(
      requestId ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    parserIds.push(requestId);
  }
  assert.notEqual(parserIds[0], parserIds[1]);
  const logDeadline = Date.now() + 1_000;
  while (
    !parserIds.every((id) => output.includes(`"requestId":"${id}"`)) &&
    Date.now() < logDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(
    parserIds.every((id) => output.includes(`"requestId":"${id}"`)),
    'parser logs share response request IDs',
  );
  assert.ok(!output.includes('parser-secret-sentinel'));
  assert.ok(!output.includes('unknown-request'));

  const logLines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.ok(logLines.length > 0, 'API emits startup or exception logs');
  const logRecords = logLines.map((line) => JSON.parse(line));
  assert.ok(logRecords.every((record) => record.service === 'api'));
  assert.ok(!output.includes('request completed'));
  assert.ok(!output.includes('request errored'));
  assert.ok(
    logLines.every((line) => !line.match(/"requestId":"[^"]+","requestId":"/)),
    'requestId is not serialized twice',
  );

  console.log(
    'API smoke passed: health, search, four-field failures, parser 400/413, JSON logs, and request ID correlation',
  );
} finally {
  await stopApi();
}
