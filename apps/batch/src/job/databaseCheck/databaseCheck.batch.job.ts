import { Injectable } from '@nestjs/common';

import type { BatchJob } from '@newtine/batch/runner/batch.job.js';
import { DatabaseCheckJob } from './databaseCheck.job.js';

@Injectable()
export class DatabaseCheckBatchJob implements BatchJob {
  constructor(private readonly job: DatabaseCheckJob) {}

  async run(): Promise<void> {
    await this.job.run();
  }
}
