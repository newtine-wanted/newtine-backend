import { Module } from '@nestjs/common';

import { PipelineController } from '@newtine/api/pipeline/pipeline.controller.js';
import { AuthModule } from '@newtine/api/auth/auth.module.js';
import { CoreModule } from '@newtine/core';

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [PipelineController],
})
export class PipelineModule {}
