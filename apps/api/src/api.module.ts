import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { CoreModule, createLoggerOptions } from '@newtine/core';

import { GlobalExceptionFilter } from '@newtine/api/common/filter/globalExceptionFilter.js';
import { HealthController } from '@newtine/api/health/health.controller.js';
import { IssueModule } from '@newtine/api/issue/issue.module.js';
import { PipelineModule } from '@newtine/api/pipeline/pipeline.module.js';
import { OnboardingModule } from '@newtine/api/onboarding/onboarding.module.js';
import { AuthModule } from '@newtine/api/auth/auth.module.js';
import { ReportModule } from './report/report.module.js';
import { InterestModule } from '@newtine/api/interest/interest.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(createLoggerOptions('api')),
    CoreModule,
    IssueModule,
    OnboardingModule,
    PipelineModule,
    AuthModule,
    InterestModule,
    ReportModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class ApiModule {}
