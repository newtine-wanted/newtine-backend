import type { TransactionManager } from '@newtine/core/common/transaction/transaction.manager.js';

/**
 * Transaction boundary for the reference in-memory adapter. The adapter validates
 * the complete command before mutating its synchronous state, so no await can
 * interleave the mutation and the boundary does not need a database savepoint.
 */
export class InMemoryOnboardingTransactionManager implements TransactionManager {
  execute<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}
