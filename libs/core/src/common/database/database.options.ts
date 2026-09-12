import type { MikroOrmModuleOptions } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { DatabaseConfigurationException } from './databaseConfiguration.exception.js';

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
    entities: [],
    entitiesTs: [],
    discovery: { warnWhenNoEntities: false },
    allowGlobalContext: false,
    ensureDatabase: false,
    registerRequestContext: true,
    debug: env.NODE_ENV === 'development',
  };
}
