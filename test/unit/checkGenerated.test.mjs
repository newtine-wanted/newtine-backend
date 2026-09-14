import { Buffer } from 'node:buffer';
import { describe, expect, test } from '@jest/globals';

import {
  canonicalizeFunctionalIndex,
  canonicalizeOpenApi,
  canonicalizeGenerated,
} from '../../scripts/check-generated.mjs';

describe('generated artifact canonicalization', () => {
  test('sorts OpenAPI object keys recursively without changing array order', () => {
    const input = JSON.stringify({
      paths: {
        '/z': { get: { responses: {} } },
        '/a': { post: { responses: {} } },
      },
      tags: ['z', 'a'],
    });

    expect(canonicalizeOpenApi(input)).toBe(`{
  "paths": {
    "/a": {
      "post": {
        "responses": {}
      }
    },
    "/z": {
      "get": {
        "responses": {}
      }
    }
  },
  "tags": [
    "z",
    "a"
  ]
}\n`);
  });

  test('sorts only functional export lines', () => {
    const input = [
      '/** generated */',
      'export * as z from "./z/index";',
      'export * as a from "./a/index";',
      '// keep this line',
      '',
    ].join('\n');

    expect(canonicalizeFunctionalIndex(input)).toBe(
      [
        '/** generated */',
        'export * as a from "./a/index";',
        'export * as z from "./z/index";',
        '// keep this line',
        '',
      ].join('\n'),
    );
  });

  test('preserves the functional index newline style', () => {
    const input = ['export * as z from "./z/index";', 'export * as a from "./a/index";', ''].join(
      '\r\n',
    );

    expect(canonicalizeFunctionalIndex(input)).toBe(
      ['export * as a from "./a/index";', 'export * as z from "./z/index";', ''].join('\r\n'),
    );
  });

  test('does not normalize files outside the explicit allowlist', () => {
    const input = Buffer.from('generated content');

    expect(canonicalizeGenerated('generated/api/index.ts', input)).toBe(input);
  });
});
