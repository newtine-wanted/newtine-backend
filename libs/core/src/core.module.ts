import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { createDatabaseOptions } from '@newtine/core/common/database/database.options.js';
import { MikroOrmTransactionManager } from '@newtine/core/common/transaction/mikroOrm/mikroOrm.transactionManager.js';
import { TRANSACTION_MANAGER } from '@newtine/core/common/transaction/transaction.manager.js';

@Module({
  imports: [MikroOrmModule.forRootAsync({ useFactory: () => createDatabaseOptions() })],
  providers: [
    MikroOrmTransactionManager,
    {
      provide: TRANSACTION_MANAGER,
      useExisting: MikroOrmTransactionManager,
    },
  ],
  exports: [TRANSACTION_MANAGER],
})
export class CoreModule {}
