import { generateUuidV7, type DiscoveredArticle } from '@newtine/core';
import {
  checkedIndexes,
  filterArticles,
  mergeCandidates,
  mergeQueries,
  normalizedTitle,
  validateGroups,
} from './discovery.policy.js';
import type {
  Candidate,
  DiscoveryConfig,
  DiscoveryModel,
  DiscoveryRun,
  DiscoveryStore,
} from './discovery.types.js';

export class DiscoveryService {
  constructor(
    private readonly store: DiscoveryStore,
    private readonly search: { search(query: string, limit: number): Promise<DiscoveredArticle[]> },
    private readonly model: DiscoveryModel,
    private readonly progress?: (event: {
      runId: string;
      completedQueries: number;
      totalQueries: number;
    }) => void,
  ) {}
  async execute(
    config: DiscoveryConfig,
    at = new Date(),
    signal?: AbortSignal,
  ): Promise<DiscoveryRun> {
    const run = await this.store.claim(at, config);
    if (run.completed) return run;
    let heartbeatError: unknown;
    let beating = false;
    const timer = setInterval(() => {
      if (beating) return;
      beating = true;
      void this.store
        .heartbeat(run)
        .catch((e) => {
          heartbeatError = e;
        })
        .finally(() => {
          beating = false;
        });
    }, 30_000);
    const check = (): void => {
      signal?.throwIfAborted();
      if (heartbeatError) throw heartbeatError;
    };
    try {
      const snapshot = run.snapshot;
      // Retry uses the original time window, config and persisted results.
      const limits = snapshot.config;
      const since = new Date(Date.parse(snapshot.at) - 24 * 3600_000).toISOString();
      check();
      if (!snapshot.queries) {
        snapshot.tracks = await this.store.tracks(snapshot.at);
        snapshot.queries = mergeQueries([
          ...(await this.store.catalog(since, limits.entityTypes)),
          ...snapshot.tracks.flatMap((t) =>
            [...new Set([t.title, ...t.keywords])].map((text) => ({
              text,
              origins: ['FOLLOW_UP'],
              parentIssueId: t.issueId,
              since: t.lastCheckedAt,
            })),
          ),
        ]);
        if (snapshot.queries.length > limits.maxQueries) throw new Error('QUERY_LIMIT_EXCEEDED');
        await this.store.save(run);
      }
      if (snapshot.queries.length > limits.maxQueries) throw new Error('QUERY_LIMIT_EXCEEDED');
      for (let index = snapshot.results.length; index < snapshot.queries.length; index++) {
        check();
        const query = snapshot.queries[index]!;
        const articles = filterArticles(
          await this.search.search(query.text, limits.articlesPerQuery),
          query,
          snapshot.at,
          limits.articlesPerQuery,
        );
        check();
        const extracted = articles.length
          ? await this.model.extract(
              articles.map((a) => a.title),
              limits.candidatesPerQuery,
            )
          : [];
        if (!Array.isArray(extracted) || extracted.length > limits.candidatesPerQuery)
          throw new Error('INVALID_CANDIDATE_COUNT');
        let candidates: Candidate[] = extracted.map((c) => {
          if (typeof c?.title !== 'string' || !c.title.trim() || c.title.length > 200)
            throw new Error('INVALID_CANDIDATE_TITLE');
          // Repeated evidence references are harmless; preserve each article only once.
          const indices = checkedIndexes(
            Array.isArray(c.titleIndexes) ? [...new Set(c.titleIndexes)] : c.titleIndexes,
            articles.length,
          );
          const id = generateUuidV7();
          return {
            id,
            title: c.title.trim(),
            articles: indices.map((i) => articles[i]!),
            queries: [query.text],
            origins: query.origins,
            parentIssueIds: query.parentIssueId ? [query.parentIssueId] : [],
            mergedCandidateIds: [id],
          };
        });
        if (query.parentIssueId && candidates.length) {
          const track = snapshot.tracks!.find((t) => t.issueId === query.parentIssueId)!;
          const indices = checkedIndexes(
            await this.model.newDevelopments(
              [track.title, ...track.knownTitles],
              candidates.map((c) => c.title),
            ),
            candidates.length,
            true,
          );
          candidates = indices.map((i) => candidates[i]!);
        }
        check();
        snapshot.results.push({ query, articles, candidates });
        snapshot.usage.push(...(this.model.usage?.splice(0) ?? []));
        await this.store.save(run);
        this.progress?.({
          runId: run.id,
          completedQueries: snapshot.results.length,
          totalQueries: snapshot.queries.length,
        });
      }
      check();
      // Exact matching first; semantic comparison still sees every distinct candidate.
      const exact = new Map<string, Candidate[]>();
      for (const c of snapshot.results.flatMap((r) => r.candidates)) {
        const key = normalizedTitle(c.title);
        exact.set(key, [...(exact.get(key) ?? []), c]);
      }
      const candidates = [...exact.values()].map(mergeCandidates);
      if (candidates.length > limits.maxCandidates) throw new Error('CANDIDATE_LIMIT_EXCEEDED');
      const groups =
        candidates.length > 1
          ? await this.model.groups(candidates.map((c) => c.title))
          : candidates.map((_, i) => [i]);
      validateGroups(groups, candidates.length);
      snapshot.candidates = groups.map((g) => mergeCandidates(g.map((i) => candidates[i]!)));
      check();
      snapshot.usage.push(...(this.model.usage?.splice(0) ?? []));
      await this.store.complete(run);
      return run;
    } catch (error) {
      // Never store upstream response bodies or credentials in failure messages.
      const message =
        error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)
          ? error.message
          : 'DISCOVERY_EXTERNAL_ERROR';
      const usage = this.model.usage?.splice(0) ?? [];
      if (usage.length) {
        run.snapshot.usage.push(...usage);
        // A fenced/failed DB write must not mask the original error.
        try {
          await this.store.save(run);
        } catch {
          /* fail() remains owner-fenced */
        }
      }
      await this.store.fail(run, message);
      throw error;
    } finally {
      clearInterval(timer);
    }
  }
}
