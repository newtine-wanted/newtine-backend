import { Module } from '@nestjs/common';

import { CoreModule } from '@newtine/core';
import { MetadataController } from './metadata.controller.js';
import { MetadataService } from './metadata.service.js';

@Module({
  imports: [CoreModule],
  controllers: [MetadataController],
  providers: [MetadataService],
})
export class MetadataModule {}
