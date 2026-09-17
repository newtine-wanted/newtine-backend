import type { EntityManager } from '@mikro-orm/core';
import type { PostgreSqlConnection } from '@mikro-orm/postgresql';

/** Execute PostgreSQL positional parameters without ORM placeholder interpolation. */
export async function executePostgresSql<T>(
  em: EntityManager,
  query: string,
  params: unknown[] = [],
): Promise<T> {
  const connection = em.getConnection() as PostgreSqlConnection;
  const transactionContext =
    typeof (em as EntityManager & { getTransactionContext?: () => unknown })
      .getTransactionContext === 'function'
      ? em.getTransactionContext()
      : undefined;
  const fallbackExecute = (): Promise<T> =>
    (
      connection as unknown as {
        execute: (
          query: string,
          params: unknown[],
          method: string,
          context: unknown,
        ) => Promise<unknown>;
      }
    ).execute(query, params, 'all', transactionContext) as Promise<T>;

  // Lightweight repository tests use a small connection double. The real
  // PostgreSQL connection always takes the raw executeQuery path below.
  if (
    typeof (connection as PostgreSqlConnection & { ensureConnection?: unknown })
      .ensureConnection !== 'function' ||
    typeof (connection as PostgreSqlConnection & { getClient?: unknown }).getClient !== 'function'
  ) {
    return fallbackExecute();
  }

  await connection.ensureConnection();
  const client = transactionContext ?? connection.getClient();
  if (typeof (client as { executeQuery?: unknown }).executeQuery !== 'function') {
    return fallbackExecute();
  }

  const result = await (
    client as {
      executeQuery: (options: {
        sql: string;
        parameters: unknown[];
        query: { kind: 'RawNode'; sqlFragments: string[]; parameters: never[] };
      }) => Promise<{ rows: unknown }>;
    }
  ).executeQuery({
    sql: query,
    parameters: params,
    query: { kind: 'RawNode', sqlFragments: [query], parameters: [] },
  });
  return result.rows as T;
}
