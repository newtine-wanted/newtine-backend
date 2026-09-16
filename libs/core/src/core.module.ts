import { MikroOrmAiUsageRepository } from './usage/mikroOrmAiUsage.repository.js';
import { AI_USAGE_REPOSITORY, REPORT_REPOSITORY } from './report/report.model.js';
import { MikroOrmReportRepository } from './report/mikroOrmReport.repository.js';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { createDatabaseOptions } from '@newtine/core/common/database/database.options.js';
import { MikroOrmTransactionManager } from '@newtine/core/common/transaction/mikroOrm/mikroOrm.transactionManager.js';
import { TRANSACTION_MANAGER } from '@newtine/core/common/transaction/transaction.manager.js';
import { PipelineRunService } from '@newtine/core/pipeline/application/pipeline.run.service.js';
import { MikroOrmPipelineRepository } from '@newtine/core/pipeline/repository/mikroOrmPipeline.repository.js';
import { PIPELINE_RUN_REPOSITORY } from '@newtine/core/pipeline/repository/pipeline.repository.js';
import { ONBOARDING_REPOSITORY } from '@newtine/core/onboarding/onboarding.model.js';
import { PostgresOnboardingRepository } from '@newtine/core/onboarding/postgresOnboarding.repository.js';
import { AUTH_REPOSITORY } from '@newtine/core/auth/repository/auth.repository.js';
import { PostgresAuthRepository } from '@newtine/core/auth/postgresAuth.repository.js';
import {
  INTEREST_REPOSITORY,
  INTEREST_WRITE_REPOSITORY,
} from '@newtine/core/interest/interest.model.js';
import { MikroOrmInterestRepository } from '@newtine/core/interest/mikroOrmInterest.repository.js';

@Module({
  imports: [MikroOrmModule.forRootAsync({ useFactory: () => createDatabaseOptions() })],
  providers: [
    MikroOrmTransactionManager,
    MikroOrmPipelineRepository,
    PipelineRunService,
    { provide: AI_USAGE_REPOSITORY, useClass: MikroOrmAiUsageRepository },
    { provide: REPORT_REPOSITORY, useClass: MikroOrmReportRepository },
    {
      provide: TRANSACTION_MANAGER,
      useExisting: MikroOrmTransactionManager,
    },
    {
      provide: PIPELINE_RUN_REPOSITORY,
      useExisting: MikroOrmPipelineRepository,
    },
    {
      provide: ONBOARDING_REPOSITORY,
      useClass: PostgresOnboardingRepository,
    },
    {
      provide: AUTH_REPOSITORY,
      useClass: PostgresAuthRepository,
    },
    {
      provide: INTEREST_REPOSITORY,
      useClass: MikroOrmInterestRepository,
    },
    {
      provide: INTEREST_WRITE_REPOSITORY,
      useExisting: INTEREST_REPOSITORY,
    },
  ],
  exports: [
    AI_USAGE_REPOSITORY,
    REPORT_REPOSITORY,
    MikroOrmTransactionManager,
    TRANSACTION_MANAGER,
    ONBOARDING_REPOSITORY,
    PIPELINE_RUN_REPOSITORY,
    PipelineRunService,
    AUTH_REPOSITORY,
    INTEREST_REPOSITORY,
    INTEREST_WRITE_REPOSITORY,
  ],
})
export class CoreModule {}
