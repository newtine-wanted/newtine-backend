import { Module } from '@nestjs/common';

import { IssueController } from '@newtine/api/issue/issue.controller.js';
import { IssueSearchService } from '@newtine/api/issue/issueSearch.service.js';

@Module({
  controllers: [IssueController],
  providers: [IssueSearchService],
})
export class IssueModule {}
