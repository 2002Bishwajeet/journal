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
import { TRIGRAM_SEARCH_SQL } from '@/lib/db/schema';

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

export async function ensureTrigramSearch(db: PGlite): Promise<void> {
  await db.exec(TRIGRAM_SEARCH_SQL);
}
