import { REPORT_PERSISTENCE_ENTITIES } from '@newtine/core/report/persistence/report.persistence.entity.js';
import { Migration20260916000000DiagnosticReport } from '@newtine/core/report/migrations/Migration20260916000000DiagnosticReport.js';
import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { createDatabaseOptions } from '@newtine/core/common/database/database.options.js';
import { DatabaseConfigurationException } from '@newtine/core/common/database/databaseConfiguration.exception.js';
import { Migration20260914000000Authentication } from '@newtine/core/auth/migrations/Migration20260914000000Authentication.js';
import { AUTH_PERSISTENCE_ENTITIES } from '@newtine/core/auth/persistence/auth.persistence.entity.js';
import { Migration20260913000000OnboardingPersistence } from '@newtine/core/onboarding/migrations/Migration20260913000000OnboardingPersistence.js';
import { ONBOARDING_PERSISTENCE_ENTITIES } from '@newtine/core/onboarding/persistence/onboarding.persistence.entity.js';
import { AiUsageRecordEntity } from '@newtine/core/pipeline/repository/mikroOrm/aiUsageRecord.entity.js';
import { Migration20260913000001CategoryCodePrimaryKey } from '@newtine/core/pipeline/migrations/Migration20260913000001CategoryCodePrimaryKey.js';
import { Migration202609130001Pipeline } from '@newtine/core/pipeline/migrations/Migration202609130001Pipeline.js';
import { Migration202609130002PipelineEmbeddingTasks } from '@newtine/core/pipeline/migrations/Migration202609130002PipelineEmbeddingTasks.js';
import { Migration202609130003IssueCardQuery } from '@newtine/core/pipeline/migrations/Migration202609130003IssueCardQuery.js';
import { Migration202609130004IssueCardQueryReadModel } from '@newtine/core/pipeline/migrations/Migration202609130004IssueCardQueryReadModel.js';
import { Migration20260915000000MemberOnlyFeed } from '@newtine/core/pipeline/migrations/Migration20260915000000MemberOnlyFeed.js';
import { Migration20260915000001IssuePersonalizationMetadata } from '@newtine/core/pipeline/migrations/Migration20260915000001IssuePersonalizationMetadata.js';
import { Migration20260915000002GuestFeed } from '@newtine/core/pipeline/migrations/Migration20260915000002GuestFeed.js';
import { Migration20260915000003IssueCardQueryHardening } from '@newtine/core/pipeline/migrations/Migration20260915000003IssueCardQueryHardening.js';
import { Migration20260915000004FeedAlgorithmSnapshot } from '@newtine/core/pipeline/migrations/Migration20260915000004FeedAlgorithmSnapshot.js';
import { ISSUE_QUERY_PERSISTENCE_ENTITIES } from '@newtine/core/issue/persistence/issueQuery.persistence.entity.js';
import { USER_PERSISTENCE_ENTITIES } from '@newtine/core/user/persistence/user.persistence.entity.js';
import { ISSUE_PERSISTENCE_ENTITIES } from '@newtine/core/issue/persistence/issue.persistence.entity.js';
import { INTEREST_PERSISTENCE_ENTITIES } from '@newtine/core/interest/persistence/interest.persistence.entity.js';
import { Migration20260915000000InterestPersistence } from '@newtine/core/interest/migrations/Migration20260915000000InterestPersistence.js';
import { Migration20260916000000IssueCardActions } from '@newtine/core/interest/migrations/Migration20260916000000IssueCardActions.js';
import { Migration20260917000000AccountWithdrawal } from '@newtine/core/pipeline/migrations/Migration20260917000000AccountWithdrawal.js';

test('database options never enable automatic database creation', () => {
  const options = createDatabaseOptions({ NODE_ENV: 'test' });

  assert.equal(options.ensureDatabase, false);
  assert.deepEqual(options.entities, [
    ...USER_PERSISTENCE_ENTITIES,
    ...ONBOARDING_PERSISTENCE_ENTITIES,
    ...ISSUE_PERSISTENCE_ENTITIES,
    AiUsageRecordEntity,
    ...INTEREST_PERSISTENCE_ENTITIES,
    ...AUTH_PERSISTENCE_ENTITIES,
    ...REPORT_PERSISTENCE_ENTITIES,
    ...ISSUE_QUERY_PERSISTENCE_ENTITIES,
  ]);
  assert.ok(options.extensions?.length);
  assert.equal(options.migrations?.transactional, true);
  assert.equal(options.migrations?.snapshot, false);
  assert.equal(options.migrations?.snapshotOnMigrate, false);
  assert.deepEqual(options.migrations?.migrationsList, [
    Migration20260913000000OnboardingPersistence,
    Migration20260913000001CategoryCodePrimaryKey,
    Migration202609130001Pipeline,
    Migration202609130002PipelineEmbeddingTasks,
    Migration202609130003IssueCardQuery,
    Migration202609130004IssueCardQueryReadModel,
    Migration20260914000000Authentication,
    Migration20260915000000InterestPersistence,
    Migration20260915000000MemberOnlyFeed,
    Migration20260915000001IssuePersonalizationMetadata,
    Migration20260915000002GuestFeed,
    Migration20260915000003IssueCardQueryHardening,
    Migration20260915000004FeedAlgorithmSnapshot,
    Migration20260916000000DiagnosticReport,
    Migration20260916000000IssueCardActions,
    Migration20260917000000AccountWithdrawal,
  ]);
  assert.equal(options.registerRequestContext, true);
});

const production: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DB_HOST: 'db.internal',
  DB_PORT: '5433',
  DB_NAME: 'application',
  DB_USER: 'applicationUser',
  DB_PASSWORD: 'configuration-secret-sentinel',
};

test('production uses explicit database configuration', () => {
  const options = createDatabaseOptions(production);
  assert.equal(options.host, 'db.internal');
  assert.equal(options.port, 5433);
  assert.equal(options.dbName, 'application');
  assert.equal(options.user, 'applicationUser');
  assert.equal(options.password, production.DB_PASSWORD);
});

test('only explicit development and test environments allow database defaults', () => {
  for (const NODE_ENV of ['development', 'test']) {
    assert.equal(createDatabaseOptions({ NODE_ENV }).port, 5432);
  }
  for (const NODE_ENV of [undefined, 'production', 'staging', 'developmnt']) {
    assert.throws(() => createDatabaseOptions({ NODE_ENV }), DatabaseConfigurationException);
  }
});

test('every database field is required outside development and test', () => {
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    for (const value of [undefined, '', '   ']) {
      assert.throws(
        () => createDatabaseOptions({ ...production, [key]: value }),
        (exception: unknown) => {
          assert.ok(exception instanceof DatabaseConfigurationException);
          assert.ok(exception.message.startsWith(`${key}:`));
          assert.ok(!exception.message.includes(production.DB_PASSWORD!));
          return true;
        },
      );
    }
  }
});

test('invalid ports are rejected in every environment without echoing their value', () => {
  for (const NODE_ENV of ['test', 'development', 'production']) {
    for (const DB_PORT of [
      '',
      ' ',
      '0',
      '65536',
      '-1',
      '1.5',
      '1e3',
      'NaN',
      'Infinity',
      'secret',
    ]) {
      assert.throws(
        () => createDatabaseOptions({ ...production, NODE_ENV, DB_PORT }),
        (exception: unknown) => {
          assert.ok(exception instanceof DatabaseConfigurationException);
          assert.match(exception.message, /^DB_PORT:/);
          assert.ok(!exception.message.includes('secret'));
          return true;
        },
      );
    }
  }
  for (const DB_PORT of ['1', '65535']) {
    assert.equal(createDatabaseOptions({ ...production, DB_PORT }).port, Number(DB_PORT));
  }
});
