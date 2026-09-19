/* global console, process */

import { MikroORM } from '@mikro-orm/postgresql';

import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';

const DEPLOYMENT_ENVIRONMENTS = new Set(['staging', 'production']);

async function main() {
  const nodeEnv = process.env.NODE_ENV;
  if (!DEPLOYMENT_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error('NODE_ENV must be staging or production for the DB TLS preflight');
  }

  if (process.env.DB_SSL_MODE !== 'verify-full') {
    throw new Error('DB_SSL_MODE must be verify-full for the DB TLS preflight');
  }

  const options = createDatabaseOptions();
  let orm;
  try {
    orm = await MikroORM.init(options);
    await orm.connect();
    await orm.em.getConnection().execute('select 1');
    console.log(
      JSON.stringify({
        event: 'database.tls.preflight.passed',
        nodeEnv,
        sslMode: process.env.DB_SSL_MODE,
      }),
    );
  } finally {
    await orm?.close(true);
  }
}

try {
  await main();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      event: 'database.tls.preflight.failed',
      reason,
    }),
  );
  process.exitCode = 1;
}
