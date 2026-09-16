import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import {
  generateUuidV7,
  type DetailViewProgress,
  type DetailViewStarted,
  type InterestWriteRepository,
  type InteractionAcceptance,
  type TransactionManager,
} from '@newtine/core';
import { IssueActionService } from '@newtine/api/issue/issueAction.service.js';

test('issue action writes are delegated through one transaction boundary', async () => {
  const userId = generateUuidV7();
  const issueId = generateUuidV7();
  const eventId = generateUuidV7();
  const sessionId = generateUuidV7();
  const viewId = generateUuidV7();
  const calls: string[] = [];
  const acceptance: InteractionAcceptance = {
    eventId,
    issueId,
    acceptedAction: 'LIKE',
    acceptedAt: new Date('2026-09-16T00:00:00.000Z'),
  };
  const started: DetailViewStarted = {
    viewId,
    issueId,
    startedAt: new Date('2026-09-16T00:00:00.000Z'),
    expiresAt: new Date('2026-09-16T00:30:00.000Z'),
    created: true,
  };
  const progress: DetailViewProgress = {
    viewId,
    issueId,
    acceptedActiveMilliseconds: 10_000,
    totalCreditedMilliseconds: 10_000,
    dwellScore: 0.5,
  };
  const repository: InterestWriteRepository = {
    recordInteraction: async (command) => {
      calls.push(`interaction:${command.action}`);
      return acceptance;
    },
    startDetailView: async () => {
      calls.push('start');
      return started;
    },
    updateDetailView: async () => {
      calls.push('progress');
      return progress;
    },
    findCurrentInteraction: async () => {
      calls.push('read');
      return 'LIKE';
    },
  };
  const transactionManager: TransactionManager = {
    execute: async <T>(work: () => Promise<T>): Promise<T> => {
      calls.push('begin');
      const result = await work();
      calls.push('commit');
      return result;
    },
  };
  const service = new IssueActionService(repository, transactionManager);

  assert.equal(
    await service.recordInteraction({ eventId, issueId, sessionId, userId, action: 'LIKE' }),
    acceptance,
  );
  assert.equal(await service.startDetailView({ viewId, issueId, sessionId, userId }), started);
  assert.equal(
    await service.updateDetailView({ viewId, issueId, userId, activeMilliseconds: 10_000 }),
    progress,
  );
  assert.equal(await service.findCurrentAction(userId, issueId), 'LIKE');

  assert.deepEqual(calls, [
    'begin',
    'interaction:LIKE',
    'commit',
    'begin',
    'start',
    'commit',
    'begin',
    'progress',
    'commit',
    'read',
  ]);
});
