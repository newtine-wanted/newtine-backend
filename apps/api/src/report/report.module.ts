import { Module } from '@nestjs/common';
import { CoreModule } from '@newtine/core';
import { AuthModule } from '@newtine/api/auth/auth.module.js';
import { ReportController } from './report.controller.js';
import { ReportService } from './report.service.js';
@Module({
  imports: [CoreModule, AuthModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
