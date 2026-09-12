import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { NestedTransactionException } from '@newtine/core/common/transaction/transaction.exception.js';
import { MikroOrmTransactionManager } from '@newtine/core/common/transaction/mikroOrm/mikroOrm.transactionManager.js';

test('MikroOrmTransactionManager delegates work to one transactional context', async () => {
  const calls: string[] = [];
  const entityManager = {
    isInTransaction: () => false,
    transactional: async (work: () => Promise<string>) => {
      calls.push('begin');
      const result = await work();
      calls.push('commit');
      return result;
    },
  };
  const manager = new MikroOrmTransactionManager(entityManager as never);

  assert.equal(await manager.execute(async () => 'ok'), 'ok');
  assert.deepEqual(calls, ['begin', 'commit']);
});

test('MikroOrmTransactionManager propagates exceptions for rollback handling', async () => {
  const entityManager = {
    isInTransaction: () => false,
    transactional: async (work: () => Promise<never>) => work(),
  };
  const manager = new MikroOrmTransactionManager(entityManager as never);

  await assert.rejects(
    manager.execute(async () => {
      throw new Error('failed');
    }),
    /failed/,
  );
});

test('MikroOrmTransactionManager rejects nested transactions before opening a savepoint', async () => {
  let transactionalCalled = false;
  let workCalled = false;
  const entityManager = {
    isInTransaction: () => true,
    transactional: async () => {
      transactionalCalled = true;
    },
  };
  const manager = new MikroOrmTransactionManager(entityManager as never);

  await assert.rejects(
    manager.execute(async () => {
      workCalled = true;
    }),
    (exception: unknown) => exception instanceof NestedTransactionException,
  );
  assert.equal(transactionalCalled, false);
  assert.equal(workCalled, false);
});
