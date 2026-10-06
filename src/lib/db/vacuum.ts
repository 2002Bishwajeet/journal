import type { PGliteInterface } from '@electric-sql/pglite';

// Yjs compaction leaves dead tuples that nothing reclaims (see
// __tests__/dbBloat.test.ts). A plain VACUUM makes that space reusable so the
// IndexedDB data dir stops growing. It is deferred so it never competes with
// the first queries (PGlite serves one at a time).
const VACUUM_DELAY_MS = 10_000;

let scheduled = false;

/**
 * Fire-and-forget plain VACUUM shortly after boot, at most once per session.
 * Never VACUUM FULL: it rewrites the whole database. Returns immediately.
 */
export function scheduleVacuum(db: PGliteInterface, delayMs = VACUUM_DELAY_MS): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    db.exec('VACUUM').catch((err) => console.warn('[DB] VACUUM failed:', err));
  }, delayMs);
}
