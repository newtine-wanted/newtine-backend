import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Nestia appends generated files and does not remove routes deleted from the
// source tree. Keep removed public contracts from reappearing in SDK and e2e
// artifacts on the next contract generation.
await Promise.all([
  rm(join(root, 'generated/api/functional/feed_sessions'), { recursive: true, force: true }),
  rm(join(root, 'generated/api/functional/onboarding'), { recursive: true, force: true }),
  rm(join(root, 'generated/e2e/features/api/automated/test_api_feed_sessions_create.ts'), {
    force: true,
  }),
  rm(
    join(root, 'generated/e2e/features/api/automated/test_api_feed_sessions_batches_getBatch.ts'),
    {
      force: true,
    },
  ),
  rm(
    join(
      root,
      'generated/e2e/features/api/automated/test_api_onboarding_entities_searchEntities.ts',
    ),
    { force: true },
  ),
  rm(join(root, 'generated/e2e/features/api/automated/test_api_onboarding_options_getOptions.ts'), {
    force: true,
  }),
]);
