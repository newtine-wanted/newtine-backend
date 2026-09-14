/* global console, process */

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GENERATED_DIRECTORY = 'generated';
export const OPENAPI_PATH = 'generated/openapi.json';
export const FUNCTIONAL_INDEX_PATH = 'generated/api/functional/index.ts';

const FUNCTIONAL_EXPORT_PATTERN = /^export \* as [\w$]+ from ".*";$/;

export function canonicalizeGenerated(path, content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;

  if (path === OPENAPI_PATH) return canonicalizeOpenApi(text);
  if (path === FUNCTIONAL_INDEX_PATH) return canonicalizeFunctionalIndex(text);
  return content;
}

export function canonicalizeOpenApi(content) {
  const document = JSON.parse(content);
  return `${JSON.stringify(sortObjectKeys(document), null, 2)}\n`;
}

export function canonicalizeFunctionalIndex(content) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const exportIndexes = [];
  const exportLines = [];

  lines.forEach((line, index) => {
    if (!FUNCTIONAL_EXPORT_PATTERN.test(line)) return;
    exportIndexes.push(index);
    exportLines.push(line);
  });

  exportLines.sort(compareStrings);
  exportIndexes.forEach((lineIndex, exportIndex) => {
    lines[lineIndex] = exportLines[exportIndex];
  });

  return lines.join(newline);
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, entry]) => [key, sortObjectKeys(entry)]),
  );
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd });
}

function listTrackedGeneratedFiles(cwd) {
  return git(['ls-files', '-z', '--', GENERATED_DIRECTORY], cwd)
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function listUntrackedGeneratedFiles(cwd) {
  return git(['ls-files', '--others', '--exclude-standard', '--', GENERATED_DIRECTORY], cwd)
    .toString('utf8')
    .split('\n')
    .filter(Boolean);
}

function readHeadFile(path, cwd) {
  return git(['show', `HEAD:${path}`], cwd);
}

export function findGeneratedDrift({ cwd = process.cwd() } = {}) {
  const trackedFiles = listTrackedGeneratedFiles(cwd);
  const untrackedFiles = listUntrackedGeneratedFiles(cwd);
  const missingFiles = [];
  const changedFiles = [];

  for (const path of trackedFiles) {
    const currentPath = resolve(cwd, path);
    if (!existsSync(currentPath)) {
      missingFiles.push(path);
      continue;
    }

    const current = canonicalizeGenerated(path, readFileSync(currentPath));
    const expected = canonicalizeGenerated(path, readHeadFile(path, cwd));
    const currentBuffer = Buffer.from(current);
    const expectedBuffer = Buffer.from(expected);

    if (!currentBuffer.equals(expectedBuffer)) changedFiles.push(path);
  }

  return { changedFiles, missingFiles, trackedFiles, untrackedFiles };
}

export function checkGeneratedArtifacts(options) {
  const result = findGeneratedDrift(options);
  const problems = [
    ...result.changedFiles.map((path) => `changed generated file: ${path}`),
    ...result.missingFiles.map((path) => `missing generated file: ${path}`),
    ...result.untrackedFiles.map((path) => `untracked generated file: ${path}`),
  ];

  if (problems.length > 0) {
    throw new Error(
      `Generated artifacts are not committed or contain drift:\n${problems.join('\n')}`,
    );
  }

  return result;
}

function main() {
  const result = checkGeneratedArtifacts();
  console.log(
    `Generated artifacts are committed and stable (${result.trackedFiles.length} tracked files checked).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
