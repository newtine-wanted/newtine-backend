import type { DiscoveredArticle } from '@newtine/core';
import { checkedIndexes, filterArticles } from '../discovery/discovery.policy.js';
import { parseCollectionConfig, selectArticles } from './collection.policy.js';
import type {
  CollectionConfig,
  CollectionModel,
  CollectionRun,
  CollectionStore,
} from './collection.types.js';

export class CollectionService {
  constructor(
    private readonly store: CollectionStore,
    private readonly search: { search(query: string, limit: number): Promise<DiscoveredArticle[]> },
    private readonly model: CollectionModel,
    private readonly progress?: (event: {
      runId: string;
      completedCandidates: number;
      totalCandidates: number;
    }) => void,
  ) {}
  async execute(
    discoveryRunId: string,
    config: CollectionConfig,
    at = new Date(),
    signal?: AbortSignal,
  ): Promise<CollectionRun> {
    const run = await this.store.claim(discoveryRunId, at, parseCollectionConfig(config));
    if (run.completed) return run;
    let heartbeatError: unknown;
    let beating: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (beating) return;
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
      run.snapshot.usage.push(...(this.model.usage?.splice(0) ?? []));
      await this.store.save(run);
    };
    try {
      const snapshot = run.snapshot;
      const limits = parseCollectionConfig(snapshot.config);
      const since = new Date(Date.parse(snapshot.at) - 86400_000).toISOString();
      for (const result of snapshot.results) {
        check();
        if (result.status) continue;
        if (!result.existingIssues) {
          result.existingIssues = await this.store.similar(result.candidate.title, snapshot.at);
          await save();
        }
        if (!result.duplicateIssueIds) {
          check();
          const indices = result.existingIssues.length
            ? checkedIndexes(
                await this.model.duplicates(result.candidate, result.existingIssues),
                result.existingIssues.length,
                true,
              )
            : [];
          result.duplicateIssueIds = indices.map((i) => result.existingIssues![i]!.id);
          await save();
        }
        if (result.duplicateIssueIds.length) {
          result.status = 'DUPLICATE';
          result.selectedArticles = [];
        } else {
          if (!result.articles) {
            check();
            result.articles = filterArticles(
              await this.search.search(result.candidate.title, limits.articlesPerQuery),
              { text: result.candidate.title, since, origins: [] },
              snapshot.at,
              limits.articlesPerQuery,
            );
            await save();
          }
          if (!result.relevantIndexes) {
            check();
            result.relevantIndexes = result.articles.length
              ? checkedIndexes(
                  await this.model.relevant(result.candidate, result.articles),
                  result.articles.length,
                  true,
                )
              : [];
            await save();
          }
          const selected = selectArticles(
            result.relevantIndexes.map((i) => result.articles![i]!),
            limits,
          );
          result.status = selected.length < 2 ? 'INSUFFICIENT_ARTICLES' : 'SELECTED';
          result.selectedArticles = result.status === 'SELECTED' ? selected : [];
        }
        await save();
        this.progress?.({
          runId: run.id,
          completedCandidates: snapshot.results.filter((r) => r.status).length,
          totalCandidates: snapshot.results.length,
        });
      }
      check();
      await this.store.complete(run);
      return run;
    } catch (error) {
      const reason =
        error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)
          ? error.message
          : 'COLLECTION_EXTERNAL_ERROR';
      run.snapshot.usage.push(...(this.model.usage?.splice(0) ?? []));
      try {
        await this.store.save(run);
      } catch {
        /* Owner fencing still applies to fail(). */
      }
      await this.store.fail(run, reason);
      throw error;
    } finally {
      clearInterval(timer);
      await beating;
    }
  }
}
