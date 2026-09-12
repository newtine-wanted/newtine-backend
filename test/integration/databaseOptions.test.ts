import assert from 'node:assert/strict';
import { test } from '@jest/globals';

import { createDatabaseOptions } from '@newtine/core/common/database/database.options.js';
import { DatabaseConfigurationException } from '@newtine/core/common/database/databaseConfiguration.exception.js';

test('database options never enable automatic database creation', () => {
  const options = createDatabaseOptions({ NODE_ENV: 'test' });

  assert.equal(options.ensureDatabase, false);
  assert.deepEqual(options.entities, []);
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
