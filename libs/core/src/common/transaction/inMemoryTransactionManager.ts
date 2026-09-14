import type { TransactionManager } from './transaction.manager.js';

/**
 * Transaction boundary for deterministic in-memory adapters. Their state changes
 * are synchronous and validated before mutation, so no database savepoint is needed.
 */
export class InMemoryTransactionManager implements TransactionManager {
  execute<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}
