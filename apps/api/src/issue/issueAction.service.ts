import { Inject, Injectable } from '@nestjs/common';

import {
  INTEREST_WRITE_REPOSITORY,
  TRANSACTION_MANAGER,
  type DetailViewProgress,
  type DetailViewStarted,
  type InterestEventType,
  type InterestWriteRepository,
  type InteractionAcceptance,
  type TransactionManager,
  type UuidV7,
} from '@newtine/core';

@Injectable()
export class IssueActionService {
  constructor(
    @Inject(INTEREST_WRITE_REPOSITORY)
    private readonly repository: InterestWriteRepository,
    @Inject(TRANSACTION_MANAGER)
    private readonly transactionManager: TransactionManager,
  ) {}

  recordInteraction(input: {
    eventId: UuidV7;
    issueId: UuidV7;
    sessionId: UuidV7;
    userId: UuidV7;
    action: InterestEventType;
  }): Promise<InteractionAcceptance> {
    return this.transactionManager.execute(() => this.repository.recordInteraction(input));
  }

  startDetailView(input: {
    viewId: UuidV7;
    issueId: UuidV7;
    sessionId: UuidV7;
    userId: UuidV7;
  }): Promise<DetailViewStarted> {
    return this.transactionManager.execute(() => this.repository.startDetailView(input));
  }

  updateDetailView(input: {
    viewId: UuidV7;
    issueId: UuidV7;
    userId: UuidV7;
    activeMilliseconds: number;
  }): Promise<DetailViewProgress> {
    return this.transactionManager.execute(() => this.repository.updateDetailView(input));
  }

  findCurrentAction(userId: UuidV7, issueId: UuidV7): Promise<InterestEventType | null> {
    return this.repository.findCurrentInteraction(userId, issueId);
  }
}
