import { EntityManager, RequestContext } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import type { TransactionManager } from '@newtine/core/common/transaction/transaction.manager.js';
import { NestedTransactionException } from '@newtine/core/common/transaction/transaction.exception.js';

@Injectable()
export class MikroOrmTransactionManager implements TransactionManager {
  constructor(private readonly entityManager: EntityManager) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    const entityManager = RequestContext.getEntityManager() ?? this.entityManager;

    if (entityManager.isInTransaction()) {
      throw new NestedTransactionException();
    }

    return entityManager.transactional(() => work());
  }
}
