import { termKey } from '../generation/generation.policy.js';
import { applyPatches, checkedReview, repairFields, rules } from './validation.policy.js';
import type { ValidationModel, ValidationRun, ValidationStore } from './validation.types.js';
export class ValidationService {
  constructor(
    private readonly store: ValidationStore,
    private readonly model: ValidationModel,
    private readonly progress?: (e: { runId: string; completed: number; total: number }) => void,
  ) {}
  async execute(source: string, at = new Date(), signal?: AbortSignal): Promise<ValidationRun> {
    const run = await this.store.claim(source, at);
    if (run.completed) return run;
    let heartbeatError: unknown;
    let beating: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (!beating)
        beating = this.store
          .heartbeat(run)
          .catch((e) => {
            heartbeatError = e;
          })
          .finally(() => {
            beating = undefined;
          });
    }, 30000);
    const check = () => {
      signal?.throwIfAborted();
      if (heartbeatError) throw heartbeatError;
    };
    const save = async () => {
      check();
      run.snapshot.usage.push(...this.model.usage.splice(0));
      await this.store.save(run);
    };
    try {
      for (const r of run.snapshot.results) {
        check();
        if (Array.isArray(r.current.draft?.terms) && r.current.draft.terms.length > 3) {
          const terms = r.current.draft.terms;
          r.termLimit = { removedTerms: [...(r.termLimit?.removedTerms ?? []), ...terms.slice(3)] };
          r.current.draft.terms = terms.slice(0, 3);
          r.current.glossary = r.current.glossary?.filter((g) =>
            r.current.draft!.terms.some((t) => termKey(t) === termKey(g.term)),
          );
          await save();
        }
        if (r.status) continue;
        for (const phase of ['INITIAL', 'FINAL'] as const) {
          let review = r.reviews.find((v) => v.phase === phase);
          if (!review) {
            review = { phase, rules: rules(r.current, run.snapshot) };
            r.reviews.push(review);
            await save();
          }
          if (!review.rules.length && !review.semantic) {
            review.semantic = checkedReview(
              await this.model.review(r.current, run.snapshot),
              r.current,
            );
            await save();
          }
          const findings = [...review.rules, ...(review.semantic?.findings ?? [])];
          if (!findings.length) {
            r.status = 'PASSED';
            break;
          }
          if (phase === 'FINAL' || findings.some((f) => f.field === 'source')) {
            r.status = 'HELD';
            break;
          }
          if (!r.repair) {
            const fields = repairFields(findings);
            const patches = fields.length
              ? await this.model.repair(r.current, findings, fields, run.snapshot)
              : [];
            r.repair = { fields, patches };
            try {
              r.current = applyPatches(r.current, patches, fields, run.snapshot);
            } catch {
              r.repair.error = 'INVALID_VALIDATION_PATCH';
              r.status = 'HELD';
            }
            await save();
          }
          if (r.repair.error) {
            r.status = 'HELD';
            break;
          }
        }
        await save();
        this.progress?.({
          runId: run.id,
          completed: run.snapshot.results.filter((r) => r.status).length,
          total: run.snapshot.results.length,
        });
      }
      check();
      await this.store.complete(run);
      return run;
    } catch (error) {
      run.snapshot.usage.push(...this.model.usage.splice(0));
      try {
        await this.store.save(run);
      } catch {
        /* Owner fenced. */
      }
      await this.store.fail(
        run,
        error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)
          ? error.message
          : 'VALIDATION_EXTERNAL_ERROR',
      );
      throw error;
    } finally {
      clearInterval(timer);
      await beating;
    }
  }
}
