export const TRANSACTION_MANAGER = Symbol('TRANSACTION_MANAGER');

export interface TransactionManager {
  execute<T>(work: () => Promise<T>): Promise<T>;
}
