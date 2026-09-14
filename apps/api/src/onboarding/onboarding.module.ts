import { Module } from '@nestjs/common';

import { CoreModule } from '@newtine/core';
import { AuthModule } from '@newtine/api/auth/auth.module.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
