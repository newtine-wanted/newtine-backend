import type { MikroOrmModuleOptions } from '@mikro-orm/nestjs';
import { Migrator } from '@mikro-orm/migrations';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { DatabaseConfigurationException } from './databaseConfiguration.exception.js';
import { ONBOARDING_PERSISTENCE_ENTITIES } from '../../onboarding/persistence/onboarding.persistence.entity.js';
import { Migration20260913000000OnboardingPersistence } from '../../onboarding/migrations/Migration20260913000000OnboardingPersistence.js';

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
    entities: ONBOARDING_PERSISTENCE_ENTITIES,
    entitiesTs: ONBOARDING_PERSISTENCE_ENTITIES,
    extensions: [Migrator],
    migrations: {
      path: './dist/libs/core/src/onboarding/migrations',
      pathTs: './libs/core/src/onboarding/migrations',
      glob: '!(*.d).{js,ts}',
      emit: 'ts',
      migrationsList: [Migration20260913000000OnboardingPersistence],
      transactional: true,
      allOrNothing: true,
    },
    discovery: { warnWhenNoEntities: false },
    allowGlobalContext: false,
    ensureDatabase: false,
    registerRequestContext: true,
    debug: env.NODE_ENV === 'development',
  };
}
