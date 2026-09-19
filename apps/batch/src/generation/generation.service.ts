import { generateUuidV7, type DiscoveredArticle, type FetchedArticle } from '@newtine/core';
import {
  calculateScores,
  checkedClassification,
  checkDraft,
  eventTime,
  parseGenerationConfig,
  ruleClassification,
  termKey,
} from './generation.policy.js';
import type {
  Catalog,
  GenerationConfig,
  GenerationModel,
  GenerationRun,
  GenerationStore,
} from './generation.types.js';
export class GenerationService {
  constructor(
    private readonly store: GenerationStore,
    private readonly bodies: { fetch(article: DiscoveredArticle): Promise<FetchedArticle> },
    private readonly model: GenerationModel,
    private readonly progress?: (event: {
      runId: string;
      completed: number;
      total: number;
    }) => void,
  ) {}
  async execute(
    source: string,
    config: GenerationConfig,
    at = new Date(),
    signal?: AbortSignal,
  ): Promise<GenerationRun> {
    const run = await this.store.claim(source, at, parseGenerationConfig(config));
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
    }, 30_000);
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
      const s = run.snapshot;
      const limits = parseGenerationConfig(s.config);
      if (!s.catalog) {
        s.catalog = await this.store.catalog();
        await save();
      }
      for (const result of s.results) {
        check();
        if (result.status) continue;
        for (const a of result.source.selectedArticles ?? []) {
          check();
          if (
            result.articles.some((b) => b.sourceUrl === a.sourceUrl) ||
            result.fetchFailures.includes(a.sourceUrl)
          )
            continue;
          try {
            const fetched = await this.bodies.fetch({ ...a, id: a.id ?? generateUuidV7() });
            if (!fetched.body.trim()) throw new Error('EMPTY_ARTICLE_BODY');
            result.articles.push({
              ...fetched,
              body: fetched.body.slice(0, limits.bodyCharacters),
            });
          } catch {
            result.fetchFailures.push(a.sourceUrl);
          }
          await save();
        }
        if (result.articles.length < 2) result.status = 'INSUFFICIENT_BODIES';
        else {
          if (!result.draft) {
            result.draft = checkDraft(
              await this.model.generate(result.articles, limits),
              result.articles,
              limits,
            );
            await save();
          }
          if (!result.classification) {
            result.rules = ruleClassification(s.catalog, result.articles);
            const unresolved: Partial<Catalog> = {};
            for (const key of ['topics', 'regions', 'entities'] as const)
              if (!result.rules[key].length && s.catalog[key].length)
                unresolved[key] = s.catalog[key];
            const extra = Object.keys(unresolved).length
              ? checkedClassification(
                  await this.model.classify(result.draft, result.articles, unresolved),
                  unresolved,
                )
              : { topics: [], regions: [], entities: [] };
            result.classification = {
              topics: [...result.rules.topics, ...extra.topics],
              regions: [...result.rules.regions, ...extra.regions],
              entities: [...result.rules.entities, ...extra.entities],
              generations: [...new Set(result.draft.generations)],
            };
            await save();
          }
          if (!result.glossary) {
            const existing = await this.store.terms(result.draft.terms);
            const missing = result.draft.terms.filter(
              (t) => !existing.some((e) => termKey(e.term) === termKey(t)),
            );
            const created = missing.length ? await this.model.define(missing, result.draft) : [];
            if (
              created.length !== missing.length ||
              missing.some(
                (t) => created.filter((c) => c.term === t && c.definition.trim()).length !== 1,
              )
            )
              throw new Error('INVALID_TERM_DEFINITIONS');
            result.glossary = [...existing, ...created];
            await save();
          }
          Object.assign(
            result,
            eventTime(result.draft, result.articles, s.at, result.source.selectedArticles),
          );
          result.scores = calculateScores(result, s.at, limits);
          result.status = 'GENERATED';
        }
        await save();
        this.progress?.({
          runId: run.id,
          completed: s.results.filter((r) => r.status).length,
          total: s.results.length,
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
        /* The repository enforces owner fencing. */
      }
      await this.store.fail(
        run,
        error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)
          ? error.message
          : 'GENERATION_EXTERNAL_ERROR',
      );
      throw error;
    } finally {
      clearInterval(timer);
      await beating;
    }
  }
}
