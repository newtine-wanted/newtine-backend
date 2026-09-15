import { Module } from '@nestjs/common';

import { AuthModule } from '@newtine/api/auth/auth.module.js';
import { CoreModule } from '@newtine/core';
import { InterestController } from './interest.controller.js';
import { InterestService } from './interest.service.js';
import { INTEREST_OPTIONS, createInterestOptions } from './interest.options.js';

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [InterestController],
  providers: [
    InterestService,
    {
      provide: INTEREST_OPTIONS,
      useFactory: () => createInterestOptions(),
    },
  ],
  exports: [InterestService],
})
export class InterestModule {}
