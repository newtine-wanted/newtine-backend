export class NestedTransactionException extends Error {
  constructor() {
    super('Nested transactions are not supported.');
    this.name = 'NestedTransactionException';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
