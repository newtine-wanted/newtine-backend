import { EntityManager, MikroORM, RequestContext } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

@Injectable()
export class DatabaseCheckJob {
  constructor(
    private readonly orm: MikroORM,
    private readonly entityManager: EntityManager,
  ) {}

  async run(): Promise<void> {
    await this.orm.connect();
    await RequestContext.create(this.orm.em, async () => {
      const entityManager = RequestContext.getEntityManager() ?? this.entityManager;
      await entityManager.getConnection().execute('select 1');
    });
  }
}
