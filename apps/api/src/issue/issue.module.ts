import { Module } from '@nestjs/common';

import { CoreModule, ISSUE_QUERY_REPOSITORY } from '@newtine/core';
import { AuthModule } from '@newtine/api/auth/auth.module.js';
import { IssueController } from '@newtine/api/issue/issue.controller.js';
import { IssueActionController } from '@newtine/api/issue/issueAction.controller.js';
import { FeedController } from '@newtine/api/issue/feed.controller.js';
import { IssueActionService } from '@newtine/api/issue/issueAction.service.js';
import { IssueDetailService } from '@newtine/api/issue/issueDetail.service.js';
import { IssueFeedService } from '@newtine/api/issue/issueFeed.service.js';
import { IssueSearchService } from '@newtine/api/issue/issueSearch.service.js';
import { IssueCardQueryRepository } from '@newtine/api/issue/repository/issueCardQuery.repository.js';

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [IssueController, IssueActionController, FeedController],
  providers: [
    IssueCardQueryRepository,
    {
      provide: ISSUE_QUERY_REPOSITORY,
      useExisting: IssueCardQueryRepository,
    },
    IssueSearchService,
    IssueFeedService,
    IssueDetailService,
    IssueActionService,
  ],
  exports: [ISSUE_QUERY_REPOSITORY],
})
export class IssueModule {}
