import type { EntityManager } from '@mikro-orm/core';
import { generateUuidV7 } from '@newtine/core';
import { executePostgresSql } from '@newtine/core/common/database/postgresSql.js';
import type { GenerationSnapshot } from '../generation/generation.types.js';
import { GenerationRepository } from '../generation/generation.repository.js';
import type { ValidationRun, ValidationSnapshot, ValidationStore } from './validation.types.js';

type RunRow = { id: string; owner: string; status: string; snapshot: ValidationSnapshot };
export class ValidationRepository implements ValidationStore {
  constructor(private readonly em: EntityManager) {}
  async claim(
    generationRunId: string,
    at: Date,
    aiValidationEnabled = false,
  ): Promise<ValidationRun> {
    const mode = aiValidationEnabled ? 'AI' : 'RULES_ONLY';
    return this.em.transactional(async (em) => {
      await executePostgresSql(em, 'select pg_advisory_xact_lock(92020004)');
      const previous = await executePostgresSql<RunRow[]>(
        em,
        'select * from news_validation_runs where generation_run_id = $1 and validation_mode = $2',
        [generationRunId, mode],
      );
      if (previous[0]?.status === 'COMPLETED')
        return { ...previous[0], generationRunId, completed: true };
      const sources = await executePostgresSql<{ snapshot: GenerationSnapshot }[]>(
        em,
        "select snapshot from news_generation_runs where id = $1 and status = 'COMPLETED'",
        [generationRunId],
      );
      const candidates = sources[0]?.snapshot.results?.filter((r) => r.status === 'GENERATED');
      if (!Array.isArray(candidates)) throw new Error('COMPLETED_GENERATION_REQUIRED');
      await executePostgresSql(
        em,
        "update news_validation_runs set status = 'FAILED', error_code = 'LEASE_EXPIRED' where status = 'RUNNING' and heartbeat_at < now() - interval '5 minutes'",
      );
      const active = await executePostgresSql<{ id: string }[]>(
        em,
        "select id from news_validation_runs where status = 'RUNNING'",
      );
      if (active.length) throw new Error('VALIDATION_ALREADY_RUNNING');
      const snapshot: ValidationSnapshot = {
        aiValidationEnabled,
        at: at.toISOString(),
        generationAt: sources[0]!.snapshot.at,
        config: sources[0]!.snapshot.config,
        catalog: await new GenerationRepository(em).catalog(),
        results: candidates.map((source) => ({
          original: source,
          current: structuredClone(source),
          reviews: [],
        })),
        usage: [],
      };
      const rows = await executePostgresSql<RunRow[]>(
        em,
        `insert into news_validation_runs (id, generation_run_id, owner, status, snapshot, validation_mode)
        values ($1, $2, $3, 'RUNNING', $4::jsonb, $5)
        on conflict (generation_run_id, validation_mode) do update set owner = excluded.owner, status = 'RUNNING', error_code = null,
        heartbeat_at = now(), finished_at = null returning *`,
        [generateUuidV7(), generationRunId, generateUuidV7(), JSON.stringify(snapshot), mode],
      );
      return { ...rows[0]!, generationRunId, completed: false };
    });
  }
  async save(run: ValidationRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      `update news_validation_runs set snapshot = $3::jsonb, heartbeat_at = now()
      where id = $1 and owner = $2 and status = 'RUNNING' returning id`,
      [run.id, run.owner, JSON.stringify(run.snapshot)],
    );
    if (!rows.length) throw new Error('VALIDATION_LEASE_LOST');
  }
  async heartbeat(run: ValidationRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      "update news_validation_runs set heartbeat_at = now() where id = $1 and owner = $2 and status = 'RUNNING' returning id",
      [run.id, run.owner],
    );
    if (!rows.length) throw new Error('VALIDATION_LEASE_LOST');
  }
  async complete(run: ValidationRun): Promise<void> {
    const rows = await executePostgresSql<{ id: string }[]>(
      this.em,
      `update news_validation_runs set status = 'COMPLETED', snapshot = $3::jsonb, finished_at = now()
      where id = $1 and owner = $2 and status = 'RUNNING' returning id`,
      [run.id, run.owner, JSON.stringify(run.snapshot)],
    );
    if (!rows.length) throw new Error('VALIDATION_LEASE_LOST');
    run.completed = true;
  }
  async fail(run: ValidationRun, reason: string): Promise<void> {
    await executePostgresSql(
      this.em,
      "update news_validation_runs set status = 'FAILED', error_code = $3, finished_at = now() where id = $1 and owner = $2 and status = 'RUNNING'",
      [run.id, run.owner, reason],
    );
  }
}
