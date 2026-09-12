import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { CoreModule, createLoggerOptions } from '@newtine/core';

import { GlobalExceptionFilter } from '@newtine/api/common/filter/globalExceptionFilter.js';
import { HealthController } from '@newtine/api/health/health.controller.js';
import { IssueModule } from '@newtine/api/issue/issue.module.js';

@Module({
  imports: [LoggerModule.forRoot(createLoggerOptions('api')), CoreModule, IssueModule],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class ApiModule {}
