import { REPORT_PERSISTENCE_ENTITIES } from '../../report/persistence/report.persistence.entity.js';
import { Migration20260916000000DiagnosticReport } from '../../report/migrations/Migration20260916000000DiagnosticReport.js';
import type { MikroOrmModuleOptions } from '@mikro-orm/nestjs';
import { Migrator } from '@mikro-orm/migrations';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { AiUsageRecordEntity } from '@newtine/core/pipeline/repository/mikroOrm/aiUsageRecord.entity.js';
import { DatabaseConfigurationException } from './databaseConfiguration.exception.js';
import { AUTH_PERSISTENCE_ENTITIES } from '../../auth/persistence/auth.persistence.entity.js';
import { Migration20260914000000Authentication } from '../../auth/migrations/Migration20260914000000Authentication.js';
import { ONBOARDING_PERSISTENCE_ENTITIES } from '../../onboarding/persistence/onboarding.persistence.entity.js';
import { USER_PERSISTENCE_ENTITIES } from '../../user/persistence/user.persistence.entity.js';
import { ISSUE_PERSISTENCE_ENTITIES } from '../../issue/persistence/issue.persistence.entity.js';
import { Migration20260913000000OnboardingPersistence } from '../../onboarding/migrations/Migration20260913000000OnboardingPersistence.js';
import { Migration20260913000001CategoryCodePrimaryKey } from '../../pipeline/migrations/Migration20260913000001CategoryCodePrimaryKey.js';
import { Migration202609130001Pipeline } from '../../pipeline/migrations/Migration202609130001Pipeline.js';
import { Migration202609130002PipelineEmbeddingTasks } from '../../pipeline/migrations/Migration202609130002PipelineEmbeddingTasks.js';
import { Migration202609130003IssueCardQuery } from '../../pipeline/migrations/Migration202609130003IssueCardQuery.js';
import { Migration202609130004IssueCardQueryReadModel } from '../../pipeline/migrations/Migration202609130004IssueCardQueryReadModel.js';
import { Migration20260915000000MemberOnlyFeed } from '../../pipeline/migrations/Migration20260915000000MemberOnlyFeed.js';
import { Migration20260915000001IssuePersonalizationMetadata } from '../../pipeline/migrations/Migration20260915000001IssuePersonalizationMetadata.js';
import { Migration20260915000002GuestFeed } from '../../pipeline/migrations/Migration20260915000002GuestFeed.js';
import { Migration20260915000003IssueCardQueryHardening } from '../../pipeline/migrations/Migration20260915000003IssueCardQueryHardening.js';
import { Migration20260915000004FeedAlgorithmSnapshot } from '../../pipeline/migrations/Migration20260915000004FeedAlgorithmSnapshot.js';
import { ISSUE_QUERY_PERSISTENCE_ENTITIES } from '../../issue/persistence/issueQuery.persistence.entity.js';
import { INTEREST_PERSISTENCE_ENTITIES } from '../../interest/persistence/interest.persistence.entity.js';
import { Migration20260915000000InterestPersistence } from '../../interest/migrations/Migration20260915000000InterestPersistence.js';

const PERSISTENCE_ENTITIES = [
  ...USER_PERSISTENCE_ENTITIES,
  ...ONBOARDING_PERSISTENCE_ENTITIES,
  ...ISSUE_PERSISTENCE_ENTITIES,
  AiUsageRecordEntity,
  ...INTEREST_PERSISTENCE_ENTITIES,
  ...AUTH_PERSISTENCE_ENTITIES,
  ...REPORT_PERSISTENCE_ENTITIES,
] as const;

export function createDatabaseOptions(
  env: NodeJS.ProcessEnv = process.env,
): MikroOrmModuleOptions<PostgreSqlDriver> {
  const allowDefaults = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  const required = (key: string, developmentDefault: string): string => {
    const value = env[key] ?? (allowDefaults ? developmentDefault : undefined);
    if (value === undefined || value.trim() === '') {
      throw new DatabaseConfigurationException(key, 'a non-empty value is required');
    }
    return value;
  };
  const host = required('DB_HOST', '127.0.0.1');
  const portValue = required('DB_PORT', '5432');
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DatabaseConfigurationException('DB_PORT', 'must be an integer from 1 to 65535');
  }

  return {
    driver: PostgreSqlDriver,
    host,
    port,
    dbName: required('DB_NAME', 'newtine'),
    user: required('DB_USER', 'postgres'),
    password: required('DB_PASSWORD', 'postgres'),
    entities: [...PERSISTENCE_ENTITIES, ...ISSUE_QUERY_PERSISTENCE_ENTITIES],
    entitiesTs: [...PERSISTENCE_ENTITIES, ...ISSUE_QUERY_PERSISTENCE_ENTITIES],
    extensions: [Migrator],
    migrations: {
      path: './dist/libs/core/src/pipeline/migrations',
      pathTs: './libs/core/src/pipeline/migrations',
      glob: '!(*.d).{js,ts}',
      emit: 'ts',
      migrationsList: [
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
      ],
      transactional: true,
      allOrNothing: true,
      // Migrations are authored and reviewed as TypeScript SQL. Do not write a
      // database-specific schema snapshot into the source tree during deploys.
      snapshot: false,
      snapshotOnMigrate: false,
    },
    discovery: { warnWhenNoEntities: false },
    allowGlobalContext: false,
    ensureDatabase: false,
    registerRequestContext: true,
    debug: env.NODE_ENV === 'development',
  };
}
