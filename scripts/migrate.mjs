/* global console, process */

import { MikroORM } from '@mikro-orm/postgresql';

import { createDatabaseOptions } from '../dist/libs/core/src/common/database/database.options.js';

const command = process.argv[2] ?? 'up';
if (command !== 'up' && command !== 'down') {
  console.error(`Unknown migration command: ${command}. Use "up" or "down".`);
  process.exitCode = 2;
} else {
  const orm = await MikroORM.init(createDatabaseOptions());
  try {
    if (command === 'up') {
      await orm.migrator.up();
    } else {
      await orm.migrator.down();
    }
  } finally {
    await orm.close(true);
  }
}
