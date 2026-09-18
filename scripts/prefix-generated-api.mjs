/* global console, URL */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const generatedApiRoot = join(root, 'generated/api');
const routeCommentPattern =
  /(@path\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)\/(?!api(?:\/|\s|$))/g;
const routeLiteralPattern = /(["'`])\/(?!api(?:\/|["'`]))/g;

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const location = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectTypeScriptFiles(location)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(location);
  }
  return files;
}

const files = await collectTypeScriptFiles(generatedApiRoot);
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const prefixed = source
    .replace(routeCommentPattern, '$1/api/')
    .replace(routeLiteralPattern, '$1/api/');
  if (prefixed !== source) await writeFile(file, prefixed, 'utf8');
}

console.log(`Prefixed ${files.length} generated API source files with /api where needed.`);
