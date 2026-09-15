import type { TransactionManager } from '@newtine/core';

/** Test-only transaction boundary for unit tests that do not start MikroORM. */
export const testTransactionManager: TransactionManager = {
  execute: (work) => work(),
};
