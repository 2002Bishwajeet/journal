import { PGliteWorker } from '@electric-sql/pglite/worker';
import type { PGliteInterface } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import type { PGliteWithLive } from '@electric-sql/pglite/live';
import { reportBootPhase, reportBootError, clearBootError } from '../bootProgress';
import {
  dumpLegacyDatabase,
  retireLegacyDatabase,
  cleanUpLegacyDatabase,
  preserveLegacyDatabase,
  skipLegacyMigration,
  legacyMigrationSkipped,
  getStoredPGliteVersion,
  setStoredPGliteVersion,
  type LegacyDump,
} from './pglite-migrate';
import { scheduleVacuum } from './vacuum';
import { initializeSchema, TRIGRAM_SEARCH_SQL } from './schema';

// PGlite 0.5 runs Postgres 18, which can't open the Postgres 17 data dir the
// older engines left at 'idb://journal-db'. Using a new dir lets the legacy DB
// survive until its data has been restored here (see initDatabase).
const DATA_DIR = 'idb://journal-db-pg18';
const PGLITE_VERSION = '0.5';
// Marks this data dir as already carrying the legacy data. The version stamp
// alone can't: anything that resets it (an old-build tab, a rollback, two new
// tabs racing) would otherwise --clean a stale dump over the migrated data.
const MIGRATION_MARKER_TABLE = 'pglite_legacy_migrated';
// Web Lock serializing the legacy migration across tabs.
const MIGRATION_LOCK = 'journal-db-migrate';

let dbPromise: Promise<PGliteInterface> | null = null;
// In-flight retry, so concurrent Retry clicks share one attempt.
let retryPromise: Promise<PGliteInterface> | null = null;

// Lazily enabled the first time fuzzy search runs — see ensureTrigramSearch().
let trigramSearchPromise: Promise<void> | null = null;

/**
 * Enable pg_trgm and its GIN indexes on demand. Deferred out of the boot path
 * because loading the extension costs ~1–2s per launch and only fuzzy search
 * (advancedSearch) needs it. Idempotent and run-once per app load; a failure
 * clears the cached promise so the next search retries.
 */
export function ensureTrigramSearch(db: PGliteInterface): Promise<void> {
  if (!trigramSearchPromise) {
    trigramSearchPromise = (async () => {
      await db.exec(TRIGRAM_SEARCH_SQL);
    })().catch((err) => {
      trigramSearchPromise = null;
      throw err;
    });
  }
  return trigramSearchPromise;
}

export function getDatabase(): Promise<PGliteInterface> {
  if (!dbPromise) {
    reportBootPhase('db-start');
    dbPromise = initDatabase()
      .then((db) => {
        reportBootPhase('db-ready');
        clearBootError();
        if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
          void import('./dbStats').then((m) => m.logDatabaseSize(db));
        }
        scheduleVacuum(db);
        return db;
      })
      .catch((err) => {
        // The rejection stays cached on purpose: every other caller (query
        // hooks, live subscriptions, tab and session hooks) would otherwise
        // start its own migration and re-import the ~10 MB legacy engine.
        // Only retryDatabase() begins a new attempt.
        reportBootError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      });
  }
  return dbPromise;
}

/**
 * A fresh boot attempt — the boot error screen's Retry. Serialised, because two
 * concurrent attempts would interleave their boot-error reports, and the
 * previous attempt's worker is closed first: a boot that failed after the
 * worker started leaves it running, and a second worker on the same dataDir
 * would elect its own leader.
 */
export function retryDatabase(): Promise<PGliteInterface> {
  if (!retryPromise) {
    const previous = dbPromise;
    dbPromise = null;
    retryPromise = (async () => {
      if (previous) await previous.then((db) => db.close()).catch(() => {});
      return getDatabase();
    })().finally(() => {
      retryPromise = null;
    });
  }
  return retryPromise;
}

/**
 * Explicit opt-out offered after repeated migration failures: open the new
 * (empty) data dir and stop trying to migrate. Never call this automatically.
 *
 * The version is deliberately NOT stamped — that would be indistinguishable
 * from a finished migration and would let the cleanup delete the legacy data.
 * A separate skip flag keeps the old database, and the fact that it is still
 * unmigrated, visible to a later launch.
 */
export function bootWithoutLegacyData(): Promise<PGliteInterface> {
  // Both records must survive: without the keep, a later cleanup could delete
  // the data; without the skip, this launch fails the same way again. If either
  // write fails, change nothing rather than act on a choice we can't remember.
  if (!preserveLegacyDatabase() || !skipLegacyMigration()) {
    return Promise.reject(
      new Error("Couldn't save that choice — check your browser's storage settings, then try again"),
    );
  }
  console.warn('[DB] Opening without the legacy data at the user\'s request; the legacy database is kept');
  return retryDatabase();
}

/**
 * Same singleton instance as getDatabase(), typed with the `live` extension
 * so callers can use PGlite live queries (db.live.incrementalQuery).
 */
export function getLiveDatabase(): Promise<PGliteWithLive> {
  return getDatabase() as Promise<PGliteWithLive>;
}

/**
 * `relaxedDurability` (the default) lets a COMMIT return before the write has
 * been flushed to IndexedDB, which is much faster but means committed data can
 * be lost in a crash. Pass false for a launch that cannot afford that.
 */
function createWorkerInstance(relaxedDurability = true): Promise<PGliteInterface> {
  const options: Record<string, unknown> = {
    dataDir: DATA_DIR,
    // Forwarded to the worker's init(), which passes it to the engine.
    relaxedDurability,
    // Must differ from the pre-0.5 build's id: PGliteWorker derives its leader
    // election lock from it, so sharing one with an old-build tab would run our
    // queries — the restore included — against that tab's legacy data dir.
    id: 'journal-pglite-pg18',
    extensions: { live },
  };
  return PGliteWorker.create(
    new Worker(new URL('./pglite-worker.ts', import.meta.url), { type: 'module' }),
    options,
  ).then((db) => {
    // WASM fetched + compiled and the worker leader elected — the slowest
    // step of a cold boot, reported for the splash progress bar.
    reportBootPhase('db-worker');
    return db;
  });
}

/**
 * Restores a legacy pg_dump into `database`, at most once. Resolves false when
 * the marker table shows this data dir already carries the legacy data.
 *
 * Exported for the real-engine test rather than kept inline: the SQL here is
 * order-sensitive in a way a mocked database can't catch — pg_dump output sets
 * search_path to '' for the whole session, so every statement after it must be
 * schema-qualified.
 */
export async function restoreLegacyDump(database: PGliteInterface, dump: string): Promise<boolean> {
  // All-or-nothing, and at most once: a failed restore rolls back, and the
  // marker table — which no legacy dump can contain — tells a later launch
  // that this dir already carries the data, whatever the stamp says.
  const restored = await database.transaction(async (tx) => {
    const marker = await tx.query<{ present: boolean }>(
      `SELECT to_regclass('public.${MIGRATION_MARKER_TABLE}') IS NOT NULL AS present`,
    );
    if (marker.rows[0]?.present) return false;
    await tx.exec(dump);
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS public.${MIGRATION_MARKER_TABLE} (migrated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
    );
    return true;
  });
  // pg_dump output clears search_path session-wide; restore the default or
  // every unqualified query in this worker session would fail.
  await database.exec('RESET search_path;');
  return restored;
}

/**
 * Runs the legacy migration when this launch still needs it. Resolves the
 * migrated database, or null to continue to the normal boot.
 */
async function migrateLegacyDatabase(): Promise<PGliteInterface | null> {
  const storedVersion = getStoredPGliteVersion();
  // The user chose to open without their legacy data; it stays on disk,
  // unmigrated, until a future launch can offer it back.
  const skipped = legacyMigrationSkipped();

  if (storedVersion !== PGLITE_VERSION && !skipped) {
    let dump: LegacyDump | null;
    try {
      dump = await dumpLegacyDatabase(storedVersion);
    } catch (err) {
      // dumpLegacyDatabase throws (LegacyMigrationError) only when a legacy
      // database exists but its dump failed. Fail the boot rather than open an
      // empty writable database: nothing is stamped or deleted, the legacy data
      // stays put, and the user isn't invited to write into a journal that a
      // later retry would --clean over.
      console.error('[DB] Legacy PGlite migration failed; not booting:', err);
      throw err;
    }
    if (dump) {
      console.log('[DB] Restoring legacy data into PGlite 0.5...');
      // Durable for this launch: relaxed durability would let the restore's
      // COMMIT return before the data reached IndexedDB, so a crash between it
      // and the legacy delete below would lose the restore while the stamp
      // claims the migration is done. Later launches run relaxed.
      const db = await createWorkerInstance(false);
      try {
        const restored = await restoreLegacyDump(db, dump.sql);
        setStoredPGliteVersion(PGLITE_VERSION);
        // The dump carries template1's contents when it came from there, which
        // is the only case where deleting without re-checking is safe.
        await retireLegacyDatabase(storedVersion, dump.fromTemplate1);
        console.log(
          restored
            ? '[DB] Migration complete, initializing schema...'
            : '[DB] Legacy data was already restored here, skipping restore',
        );
        await initializeSchema(db);
      } catch (err) {
        // A rolled-back restore leaves this dir without the legacy data, and
        // nothing stamped or deleted. Close the worker (schema failures included)
        // so a retry can elect a fresh leader, and fail instead of running empty.
        console.error('[DB] Legacy migration failed; not booting:', err);
        await db.close().catch(() => {});
        throw err;
      }
      return db;
    }
  }
  return null;
}

async function initDatabase(): Promise<PGliteInterface> {
  // Two tabs booting on legacy data would each open the legacy dir with their
  // own engine, and the first to finish would delete it under the other. The
  // lock lets one migrate; the rest re-read the stamp inside it and fall
  // through. Already-migrated boots never wait on it.
  if (getStoredPGliteVersion() !== PGLITE_VERSION && !legacyMigrationSkipped()) {
    const migrated = navigator.locks
      ? await navigator.locks.request(MIGRATION_LOCK, migrateLegacyDatabase)
      : await migrateLegacyDatabase();
    if (migrated) return migrated;
  }

  const storedVersion = getStoredPGliteVersion();
  const skipped = legacyMigrationSkipped();

  if (storedVersion === PGLITE_VERSION) {
    // The migration's own delete of the legacy DB is blocked by the tab's open
    // IndexedDB connection to it, so it outlives the migration. A launch that
    // never opens it can finish the job — off the boot path, failures logged.
    cleanUpLegacyDatabase().catch((err) => console.warn('[DB] Legacy database cleanup failed:', err));
  }

  console.log('[DB] Creating PGlite worker instance...');
  const db = await createWorkerInstance();
  try {
    // Leave the stamp alone for a skipped migration: the legacy data is still
    // there, waiting, and must not look like it was migrated.
    if (!skipped) setStoredPGliteVersion(PGLITE_VERSION);
    console.log('[DB] PGlite worker ready, initializing schema...');
    await initializeSchema(db);
    console.log('[DB] Schema initialized');
  } catch (err) {
    // Don't leak the worker: a retry would add a second one on this dataDir.
    await db.close().catch(() => {});
    throw err;
  }

  return db;
}

export async function closeDatabase(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      await db.close();
    } finally {
      dbPromise = null;
    }
  }
}
