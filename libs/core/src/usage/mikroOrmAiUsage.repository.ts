import { executeReportSql } from '../report/report.sql.js';
import { EntityManager } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import { generateUuidV7, type UuidV7 } from '../common/id/uuidV7.generator.js';
import { ReportException } from '../report/report.exception.js';
import type {
  AiUsageRepository,
  ReportUsageStart,
  ReportUsageFinish,
} from '../report/report.model.js';

@Injectable()
export class MikroOrmAiUsageRepository implements AiUsageRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async beginReport(input: ReportUsageStart): Promise<UuidV7> {
    const id = generateUuidV7();
    return this.entityManager.transactional(async (em) => {
      const userRows = await executeReportSql<{ id: string }[]>(
        em,
        'select id from users where id = $1::uuid for key share',
        [input.userId],
      );
      if (userRows.length !== 1) throw new ReportException('STALE_CLAIM');

      const reportRows = await executeReportSql<{ id: string }[]>(
        em,
        `select r.id
           from weekly_reports r
          where r.id = $2::uuid
            and r.user_id = $1::uuid
            and r.status = 'RUNNING'
            and r.attempt_count = $3
            and r.lease_token = $4::uuid
            and r.lease_expires_at > clock_timestamp()
          for share of r`,
        [input.userId, input.reportId, input.attempt, input.leaseToken],
      );
      if (reportRows.length !== 1) throw new ReportException('STALE_CLAIM');

      const usageRows = await executeReportSql<{ id: string }[]>(
        em,
        `insert into ai_usage_records
          (id, weekly_report_id, run_attempt, operation, purpose, prompt_version,
           prompt_hash, provider, status, model, started_at, created_at)
        values ($1::uuid, $2::uuid, $3, 'LLM', $4, $5, $6, 'openai', 'RUNNING', $7, $8, $8)
        returning id`,
        [
          id,
          input.reportId,
          input.attempt,
          input.purpose,
          input.promptVersion,
          input.promptHash,
          input.model,
          input.startedAt,
        ],
      );
      if (usageRows.length !== 1) throw new ReportException('STALE_CLAIM');
      return id;
    });
  }

  async finish(id: UuidV7, result: ReportUsageFinish): Promise<void> {
    for (const count of [result.inputTokens, result.outputTokens]) {
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) {
        throw new RangeError('Invalid usage token count');
      }
    }
    if (
      result.actualCost !== undefined &&
      (!Number.isFinite(result.actualCost) || result.actualCost < 0)
    ) {
      throw new RangeError('Invalid usage cost');
    }
    // UNKNOWN can be reconciled by a late provider response; a known terminal
    // result must never be downgraded by lease recovery or shutdown cleanup.
    await executeReportSql(
      this.entityManager,
      `update ai_usage_records
          set status = $2, model = coalesce($3, model),
              input_tokens = $4, output_tokens = $5, actual_cost = $6,
              error_code = $7, finished_at = $8
        where id = $1 and status in ('RUNNING', 'UNKNOWN')`,
      [
        id,
        result.status,
        result.model ?? null,
        result.inputTokens ?? null,
        result.outputTokens ?? null,
        result.actualCost ?? null,
        result.errorCode ?? null,
        result.finishedAt,
      ],
    );
  }
}
