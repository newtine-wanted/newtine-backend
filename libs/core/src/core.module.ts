import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { createDatabaseOptions } from '@newtine/core/common/database/database.options.js';
import { MikroOrmTransactionManager } from '@newtine/core/common/transaction/mikroOrm/mikroOrm.transactionManager.js';
import { TRANSACTION_MANAGER } from '@newtine/core/common/transaction/transaction.manager.js';
import { PipelineRunService } from '@newtine/core/pipeline/application/pipeline.run.service.js';
import { MikroOrmPipelineRepository } from '@newtine/core/pipeline/repository/mikroOrmPipeline.repository.js';
import { PIPELINE_RUN_REPOSITORY } from '@newtine/core/pipeline/repository/pipeline.repository.js';

@Module({
  imports: [MikroOrmModule.forRootAsync({ useFactory: () => createDatabaseOptions() })],
  providers: [
    MikroOrmTransactionManager,
    MikroOrmPipelineRepository,
    PipelineRunService,
    {
      provide: TRANSACTION_MANAGER,
      useExisting: MikroOrmTransactionManager,
    },
    {
      provide: PIPELINE_RUN_REPOSITORY,
      useExisting: MikroOrmPipelineRepository,
    },
  ],
  exports: [TRANSACTION_MANAGER, PIPELINE_RUN_REPOSITORY, PipelineRunService],
})
export class CoreModule {}
