import { checkedRunStatus } from '@newtine/core/news-pipeline/newsPipeline.policy.js';
import { raw, type EntityManager } from '@mikro-orm/core';
import type { EntityManager as SqlEntityManager } from '@mikro-orm/postgresql';
import { generateUuidV7 } from '@newtine/core';
import { executePostgresSql } from '@newtine/core/common/database/postgresSql.js';
import { IssueSchema } from '@newtine/core/issue/persistence/issue.persistence.entity.js';
import {
  NewsCollectionRunSchema,
  NewsDiscoveryRunSchema,
  NewsIssueSearchSchema,
  type NewsCollectionRun,
} from '@newtine/core/news-pipeline/newsPipeline.entity.js';
import type { DiscoverySnapshot } from '../discovery/discovery.types.js';
import type {
  CollectionConfig,
  CollectionRun,
  CollectionSnapshot,
  CollectionStore,
  SimilarIssue,
} from './collection.types.js';

const DETACHED = { disableIdentityMap: true } as const;
const LEASE_MS = 5 * 60_000;
function asRun(row: NewsCollectionRun): CollectionRun {
  return {
    id: row.id,
    owner: row.owner,
    discoveryRunId: row.discoveryRunId,
    snapshot: structuredClone(row.snapshot) as CollectionSnapshot,
    completed: row.status === 'COMPLETED',
  };
}
export class CollectionRepository implements CollectionStore {
  constructor(private readonly em: EntityManager) {}
  private async lock(em: EntityManager): Promise<void> {
    // PostgreSQL transaction-scoped lock serializes claims even before a run row exists.
    await executePostgresSql(em, 'select pg_advisory_xact_lock(92020002)');
  }
  private async synchronizeSearch(em: EntityManager, at: string): Promise<void> {
    const until = new Date(at);
    const issues = await em.find(
      IssueSchema,
      {
        publicationStatus: 'PUBLISHED',
        publishedAt: { $gte: new Date(until.getTime() - 7 * 86400_000), $lte: until },
      },
      { ...DETACHED, fields: ['id', 'title', 'publishedAt'] },
    );
    await em.nativeDelete(NewsIssueSearchSchema, {});
    if (issues.length)
      await em.insertMany(
        NewsIssueSearchSchema,
        issues.map((issue) => ({
          issueId: issue.id,
          title: issue.title,
          publishedAt: issue.publishedAt!,
        })),
      );
  }
  async refreshSearchIndex(at: string): Promise<void> {
    await this.em.transactional(async (em) => {
      await this.lock(em);
      if (await em.count(NewsCollectionRunSchema, { status: 'RUNNING' }))
        throw new Error('COLLECTION_ALREADY_RUNNING');
      await this.synchronizeSearch(em, at);
    });
  }
  async claim(discoveryRunId: string, at: Date, config: CollectionConfig): Promise<CollectionRun> {
    return this.em.transactional(async (em) => {
      await this.lock(em);
      const previous = await em.findOne(NewsCollectionRunSchema, { discoveryRunId }, DETACHED);
      if (previous) checkedRunStatus(previous.status);
      if (previous?.status === 'COMPLETED') return asRun(previous);
      const source = await em.findOne(
        NewsDiscoveryRunSchema,
        { id: discoveryRunId, status: 'COMPLETED' },
        DETACHED,
      );
      const candidates = (source?.snapshot as DiscoverySnapshot | undefined)?.candidates;
      if (!Array.isArray(candidates)) throw new Error('COMPLETED_DISCOVERY_REQUIRED');
      const now = new Date();
      await em.nativeUpdate(
        NewsCollectionRunSchema,
        { status: 'RUNNING', heartbeatAt: { $lt: new Date(now.getTime() - LEASE_MS) } },
        { status: 'FAILED', errorCode: 'LEASE_EXPIRED' },
      );
      if (await em.count(NewsCollectionRunSchema, { status: 'RUNNING' }))
        throw new Error('COLLECTION_ALREADY_RUNNING');
      const snapshot: CollectionSnapshot = previous
        ? (structuredClone(previous.snapshot) as CollectionSnapshot)
        : {
            at: at.toISOString(),
            config,
            results: candidates.map((candidate) => ({ candidate })),
            usage: [],
          };
      const row: NewsCollectionRun = {
        id: previous?.id ?? generateUuidV7(),
        discoveryRunId,
        owner: generateUuidV7(),
        status: 'RUNNING',
        snapshot,
        errorCode: null,
        heartbeatAt: now,
        finishedAt: null,
      };
      if (previous)
        await em.nativeUpdate(
          NewsCollectionRunSchema,
          { id: previous.id },
          {
            owner: row.owner,
            status: row.status,
            errorCode: null,
            heartbeatAt: now,
            finishedAt: null,
          },
        );
      else await em.insert(NewsCollectionRunSchema, row);
      await this.synchronizeSearch(em, snapshot.at);
      return asRun(row);
    });
  }
  async similar(title: string, at: string): Promise<SimilarIssue[]> {
    // pg_trgm is PostgreSQL-specific; filtering and retrieval still use the ORM.
    const until = new Date(at);
    return (this.em as SqlEntityManager)
      .createQueryBuilder(NewsIssueSearchSchema)
      .select(['issueId as id', 'title', raw('similarity(title, ?) as similarity', [title])])
      .where({ publishedAt: { $gte: new Date(until.getTime() - 7 * 86400_000), $lte: until } })
      .orderBy([
        { [raw('title <-> ?', [title])]: 'asc' },
        { publishedAt: 'desc' },
        { issueId: 'asc' },
      ])
      .limit(10)
      .execute<SimilarIssue[]>('all', false);
  }
  private async updateOwned(run: CollectionRun, data: Partial<NewsCollectionRun>): Promise<void> {
    if (data.status !== undefined) checkedRunStatus(data.status);
    const count = await this.em.nativeUpdate(
      NewsCollectionRunSchema,
      { id: run.id, owner: run.owner, status: 'RUNNING' },
      data,
    );
    if (!count) throw new Error('COLLECTION_LEASE_LOST');
  }
  async save(run: CollectionRun): Promise<void> {
    await this.updateOwned(run, { snapshot: run.snapshot, heartbeatAt: new Date() });
  }
  async heartbeat(run: CollectionRun): Promise<void> {
    await this.updateOwned(run, { heartbeatAt: new Date() });
  }
  async complete(run: CollectionRun): Promise<void> {
    await this.updateOwned(run, {
      status: 'COMPLETED',
      snapshot: run.snapshot,
      finishedAt: new Date(),
    });
    run.completed = true;
  }
  async fail(run: CollectionRun, reason: string): Promise<void> {
    await this.em.nativeUpdate(
      NewsCollectionRunSchema,
      { id: run.id, owner: run.owner, status: 'RUNNING' },
      { status: 'FAILED', errorCode: reason },
    );
  }
}
