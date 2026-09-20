import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { reusableTerms } from '@newtine/batch/preparation/preparation.service.js';

test('term preparation normalizes keys and excludes conflicting or malformed definitions', () => {
  const result = reusableTerms([
    [
      { term: ' ＡＩ   정책 ', definition: ' 설명 ' },
      { term: 'ai 정책', definition: '설명' },
    ],
    [
      { term: '충돌', definition: '하나' },
      { term: '충돌', definition: '둘' },
    ],
    null,
    {},
    [null, { term: '', definition: '설명' }, { term: '무효', definition: 3 }],
  ]);
  assert.deepEqual(result, [
    { normalizedTerm: 'ai 정책', term: 'ＡＩ   정책', definition: '설명' },
  ]);
});
