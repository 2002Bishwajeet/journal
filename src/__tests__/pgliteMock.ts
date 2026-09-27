/**
 * Shared mock for `@/lib/db/pglite`, used by every test that needs the real
 * `@/lib/db/queries` functions to run against an in-memory test database
 * instead of the app's real singleton.
 *
 * Usage:
 *   vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
 *   import { setTestDb } from './pgliteMock';
 *   ...
 *   setTestDb(db);
 *
 * If a file's mock needs extra members beyond the four below, spread this
 * module instead of hand-rolling a factory:
 *   vi.mock('@/lib/db/pglite', async () => ({ ...(await import('./pgliteMock')), extra }));
 */
import type { PGlite } from '@electric-sql/pglite';

let testDb: PGlite | null = null;

export function setTestDb(db: PGlite): void {
  testDb = db;
}

export async function getDatabase(): Promise<PGlite | null> {
  return testDb;
}

export async function getLiveDatabase(): Promise<PGlite | null> {
  return testDb;
}

// Mirrors the SQL in the real `ensureTrigramSearch` (src/lib/db/pglite.ts).
// Once #157 extracts that into `src/lib/db/schema.ts` as `TRIGRAM_SEARCH_SQL`,
// this should import it from there instead of duplicating the text.
const TRIGRAM_SEARCH_SQL = `
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_search_title_trgm ON search_index USING GIN(title gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_search_content_trgm ON search_index USING GIN(plain_text_content gin_trgm_ops);
`;

export async function ensureTrigramSearch(db: PGlite): Promise<void> {
  await db.exec(TRIGRAM_SEARCH_SQL);
}
