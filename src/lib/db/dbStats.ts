import type { PGliteInterface } from '@electric-sql/pglite';

export interface TableSize {
  name: string;
  totalBytes: number;
  liveTuples: number;
  deadTuples: number;
}

/** Whole-database size plus the biggest tables, for judging dead-tuple bloat. */
export async function measureDatabaseSize(
  db: PGliteInterface,
  topN = 5,
): Promise<{ databaseBytes: number; tables: TableSize[] }> {
  const size = await db.query<{ bytes: string }>('SELECT pg_database_size(current_database()) AS bytes');
  const tables = await db.query<{ name: string; bytes: string; live: string; dead: string }>(
    `SELECT relname AS name, pg_total_relation_size(relid) AS bytes,
            n_live_tup AS live, n_dead_tup AS dead
     FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT $1`,
    [topN],
  );
  return {
    databaseBytes: Number(size.rows[0].bytes),
    tables: tables.rows.map((r) => ({
      name: r.name,
      totalBytes: Number(r.bytes),
      liveTuples: Number(r.live),
      deadTuples: Number(r.dead),
    })),
  };
}

/** Dev/e2e boot diagnostic. Never throws and is never awaited by the boot path. */
export function logDatabaseSize(db: PGliteInterface): void {
  measureDatabaseSize(db)
    .then(({ databaseBytes, tables }) => {
      console.log(`[DB] size ${(databaseBytes / 1048576).toFixed(1)} MB`, tables);
    })
    .catch((err) => console.warn('[DB] size measurement failed:', err));
}
