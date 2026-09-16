import type { EntityManager } from '@mikro-orm/core';
import type { PostgreSqlConnection } from '@mikro-orm/postgresql';

/** Execute PostgreSQL positional parameters without ORM placeholder interpolation. */
export async function executeReportSql<T>(
  em: EntityManager,
  query: string,
  params: unknown[] = [],
): Promise<T> {
  const connection = em.getConnection() as PostgreSqlConnection;
  await connection.ensureConnection();
  const client = em.getTransactionContext() ?? connection.getClient();
  const result = await client.executeQuery({
    sql: query,
    parameters: params,
    query: { kind: 'RawNode', sqlFragments: [query], parameters: [] },
  });
  return result.rows as T;
}
