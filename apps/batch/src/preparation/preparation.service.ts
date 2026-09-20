import { assertTermDefinition } from '@newtine/core/news-pipeline/newsPipeline.policy.js';
import type { EntityManager } from '@mikro-orm/core';
import { IssueSchema } from '@newtine/core/issue/persistence/issue.persistence.entity.js';
import { IssueQueryDetailEntity } from '@newtine/core/issue/persistence/issueQuery.persistence.entity.js';
import { NewsTermSchema, type NewsTerm } from '@newtine/core/news-pipeline/newsPipeline.entity.js';
import { CollectionRepository } from '../collection/collection.repository.js';
import { termKey } from '../generation/generation.policy.js';

/** Keep only one unambiguous definition per normalized term, matching runtime reuse. */
export function reusableTerms(glossaries: unknown[]): NewsTerm[] {
  const terms = new Map<string, { term: string; definitions: Set<string> }>();
  for (const glossary of glossaries) {
    if (!Array.isArray(glossary)) continue;
    for (const entry of glossary) {
      if (!entry || typeof entry.term !== 'string' || typeof entry.definition !== 'string')
        continue;
      const term = entry.term.trim(),
        definition = entry.definition.trim();
      if (!term || !definition) continue;
      const key = termKey(term);
      const group = terms.get(key) ?? { term, definitions: new Set<string>() };
      group.definitions.add(definition);
      terms.set(key, group);
    }
  }
  return [...terms]
    .filter(([, value]) => value.definitions.size === 1)
    .map(([normalizedTerm, value]) => ({
      normalizedTerm,
      term: value.term,
      definition: [...value.definitions][0]!,
    }));
}
export class NewsPipelinePreparation {
  constructor(private readonly em: EntityManager) {}
  async terms(): Promise<{ eligibleTerms: number }> {
    return this.em.transactional(async (em) => {
      const published = await em.find(
        IssueSchema,
        { publicationStatus: 'PUBLISHED' },
        { fields: ['id'], disableIdentityMap: true },
      );
      const details = published.length
        ? await em.find(
            IssueQueryDetailEntity,
            { issueId: { $in: published.map((i) => i.id) } },
            { fields: ['id', 'glossary'], disableIdentityMap: true },
          )
        : [];
      const terms = reusableTerms(details.map((d) => d.glossary));
      terms.forEach(assertTermDefinition);
      if (terms.length)
        await em.upsertMany(NewsTermSchema, terms, {
          onConflictAction: 'ignore',
          onConflictFields: ['normalizedTerm'],
          disableIdentityMap: true,
        });
      return { eligibleTerms: terms.length };
    });
  }
  async search(at = new Date()): Promise<void> {
    await new CollectionRepository(this.em).refreshSearchIndex(at.toISOString());
  }
}
