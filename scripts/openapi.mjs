/* global console, process */

import { spawn } from 'node:child_process';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NESTIA_BIN = join(ROOT, 'node_modules/nestia/bin/index.js');
export const OPENAPI_OUTPUT = join(ROOT, 'generated/openapi.json');
export const PROBLEM_DETAILS_REF = '#/components/schemas/ProblemDetails';

const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);

/**
 * Rewrites only directly declared ProblemDetails failure bodies. The function
 * mutates and returns the supplied OpenAPI document so it can also be tested
 * with an in-memory fixture.
 */
export function normalizeOpenApiDocument(document) {
  if (!isRecord(document)) {
    throw new TypeError('OpenAPI document must be an object.');
  }

  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!isRecord(pathItem)) continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isRecord(operation)) continue;
      normalizeResponses(operation.responses, `${method.toUpperCase()} operation`);
    }
  }

  return document;
}

function normalizeResponses(responses, operationLabel) {
  if (!isRecord(responses)) return;

  for (const [status, response] of Object.entries(responses)) {
    if (!isFailureStatus(status) || !isRecord(response) || !isRecord(response.content)) continue;

    const jsonContent = response.content['application/json'];
    if (!isProblemDetailsContent(jsonContent)) continue;

    const problemContent = response.content['application/problem+json'];
    if (problemContent !== undefined && !isDeepStrictEqual(problemContent, jsonContent)) {
      throw new Error(
        `${operationLabel} ${status} has conflicting application/json and application/problem+json ProblemDetails content.`,
      );
    }

    response.content['application/problem+json'] = jsonContent;
    delete response.content['application/json'];
  }
}

function isProblemDetailsContent(content) {
  return (
    isRecord(content) && isRecord(content.schema) && content.schema.$ref === PROBLEM_DETAILS_REF
  );
}

function isFailureStatus(status) {
  if (/^[45]XX$/.test(status)) return true;
  if (!/^\d+$/.test(status)) return false;

  const numericStatus = Number(status);
  return numericStatus >= 400 && numericStatus < 600;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function runNestiaSwagger() {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [NESTIA_BIN, 'swagger'], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(`Nestia Swagger generation failed (code=${code}, signal=${signal ?? 'none'}).`),
      );
    });
  });
}

async function writeNormalizedDocument(document) {
  const temporaryPath = `${OPENAPI_OUTPUT}.${process.pid}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, OPENAPI_OUTPUT);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function generateOpenApi() {
  await runNestiaSwagger();

  let document;
  try {
    document = JSON.parse(await readFile(OPENAPI_OUTPUT, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Generated OpenAPI could not be read or parsed: ${message}`, {
      cause: error,
    });
  }

  normalizeOpenApiDocument(document);
  await writeNormalizedDocument(document);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateOpenApi().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
