import { Module } from '@nestjs/common';

import { PipelineController } from '@newtine/api/pipeline/pipeline.controller.js';
import { CoreModule } from '@newtine/core';

@Module({
  imports: [CoreModule],
  controllers: [PipelineController],
})
export class PipelineModule {}
