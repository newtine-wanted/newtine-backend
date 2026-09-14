import { Module } from '@nestjs/common';

import {
  CoreModule,
  InMemoryTransactionManager,
  ISSUE_QUERY_REPOSITORY,
  MikroOrmTransactionManager,
  TRANSACTION_MANAGER,
} from '@newtine/core';
import { IssueController } from '@newtine/api/issue/issue.controller.js';
import { FeedController } from '@newtine/api/issue/feed.controller.js';
import { IssueDetailService } from '@newtine/api/issue/issueDetail.service.js';
import { IssueFeedService } from '@newtine/api/issue/issueFeed.service.js';
import { IssueSearchService } from '@newtine/api/issue/issueSearch.service.js';
import { InMemoryIssueQueryRepository } from '@newtine/api/issue/repository/inMemoryIssueQuery.repository.js';
import { PostgresIssueQueryRepository } from '@newtine/api/issue/repository/postgresIssueQuery.repository.js';

@Module({
  imports: [CoreModule],
  controllers: [IssueController, FeedController],
  providers: [
    {
      provide: InMemoryIssueQueryRepository,
      useFactory: () => new InMemoryIssueQueryRepository(),
    },
    PostgresIssueQueryRepository,
    {
      provide: TRANSACTION_MANAGER,
      useFactory: (postgres: MikroOrmTransactionManager) =>
        shouldUsePostgres() ? postgres : new InMemoryTransactionManager(),
      inject: [MikroOrmTransactionManager],
    },
    {
      provide: ISSUE_QUERY_REPOSITORY,
      useFactory: (memory: InMemoryIssueQueryRepository, postgres: PostgresIssueQueryRepository) =>
        shouldUsePostgres() ? postgres : memory,
      inject: [InMemoryIssueQueryRepository, PostgresIssueQueryRepository],
    },
    IssueSearchService,
    IssueFeedService,
    IssueDetailService,
  ],
  exports: [ISSUE_QUERY_REPOSITORY],
})
export class IssueModule {}

function shouldUsePostgres(): boolean {
  return (
    process.env.ISSUE_QUERY_REPOSITORY === 'postgres' ||
    process.env.NODE_ENV === 'production' ||
    process.env.NODE_ENV === 'staging'
  );
}
