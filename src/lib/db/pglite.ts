import { PGliteWorker } from '@electric-sql/pglite/worker';
import type { PGliteInterface } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import type { PGliteWithLive } from '@electric-sql/pglite/live';
import { reportBootPhase, reportBootError, clearBootError, markBoot, startOpenProgress, reportOpenProgress, finishOpenProgress } from '../bootProgress';
import { nativePlatform } from '../native';
import {
  databaseExists,
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
import { initializeSchema, TRIGRAM_SEARCH_SQL } from './schema';
import { reloadPage } from '../reloadReason';
import { ENCRYPTED_STORE, encryptionPaused, loadDatabaseKey, PassphraseNeededError, usesEncryptedDatabase, usesPassphrase } from './databaseKey';

// PGlite 0.5 runs Postgres 18, which can't open the Postgres 17 data dir the
// older engines left at 'idb://journal-db'. Using a new dir lets the legacy DB
// survive until its data has been restored here (see initDatabase).
const DATA_DIR = 'idb://journal-db-pg18';
// DATA_DIR's IndexedDB database. In the native app it is a plain one an older build left (#1362).
export const PLAIN_DATABASE = '/pglite/journal-db-pg18';
// The Postgres 17 database of builds older than PGlite 0.5. The native app deletes it unread (#1362).
export const LEGACY_DATABASE = '/pglite/journal-db';
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

// The database worker, stopped when Safari caches the page (see onPageHide).
let currentWorker: Worker | null = null;
// Rejects when the current worker's engine could not open its database. Queries wait for an
// open engine, so without this a damaged encrypted store (#1362) would hold the splash forever.
let workerOpenFailed: Promise<never> = new Promise(() => {});

// Set when this native app launch runs on the database an older build left (#1362, #1435).
let leftoverSession = false;

/**
 * Whether this native app launch runs on the plain database an older build left, because it
 * has changes that never synced (#1362): this launch's syncs send them, and the first
 * launch that finds it all synced deletes it and opens the encrypted database. On Android
 * with encryption paused (#1435), the same for the encrypted store an older build left.
 */
export function isLeftoverSession(): boolean {
  return leftoverSession;
}

/**
 * Safari keeps a page it leaves in its back/forward cache with the database worker
 * suspended but still holding PGlite's leader election lock. The next page's worker then
 * never becomes the leader, and the app stays on the splash screen (#806). Stop the
 * worker when the page is cached, and reload the page if Safari shows it again.
 */
function onPageHide(event: PageTransitionEvent) {
  if (!event.persisted || !currentWorker) return;
  currentWorker.terminate();
  addEventListener('pageshow', () => reloadPage('pageshow-persisted'), { once: true });
}

/**
 * Android Chrome freezes a page that has been in the background for a while, and a
 * frozen worker keeps the election lock the same way, so the next launch of the app
 * hangs on the splash screen (#1006). Flush when the page is hidden, while it can still
 * run, and stop the worker when the page is frozen; reload the page when it resumes.
 */
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') void flushToIndexedDb();
}

function onFreeze() {
  if (!currentWorker) return;
  currentWorker.terminate();
  document.addEventListener('resume', () => reloadPage('freeze-resume'), { once: true });
}

// Lazily enabled by the first search that needs a substring match — see ensureTrigramSearch().
let trigramSearchPromise: Promise<void> | null = null;

/**
 * Enable pg_trgm and its GIN indexes on demand. Deferred out of the boot path
 * because loading the extension costs ~1–2s per launch and only the substring and typo stages
 * of advancedSearch need it. Idempotent and run-once per app load; a failure
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
 * Closes the database for the rest of this page: every later getDatabase() waits for the
 * reload that follows. For the reset (#1362), which deletes the database under it.
 */
export async function shutDownDatabase(): Promise<void> {
  const previous = dbPromise;
  dbPromise = new Promise(() => {});
  await previous?.then((db) => db.close()).catch(() => {});
}

/**
 * Same singleton instance as getDatabase(), typed with the `live` extension
 * so callers can use PGlite live queries (db.live.incrementalQuery).
 */
export function getLiveDatabase(): Promise<PGliteWithLive> {
  return getDatabase() as Promise<PGliteWithLive>;
}

let flushCount = 0;

/**
 * Resolves once this tab's database worker has flushed what PGlite committed to IndexedDB.
 * PGlite's own syncToFs() only starts that flush under relaxedDurability (#833). For e2e's
 * syncToDisk; a follower tab's worker holds no data dir and answers at once.
 */
export function flushToIndexedDb(): Promise<void> {
  const worker = currentWorker;
  if (!worker) return Promise.resolve();
  const id = ++flushCount;
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<{ type?: string; id?: number }>) => {
      if (event.data?.type !== 'journal-flushed' || event.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      resolve();
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'journal-flush', id });
  });
}

/**
 * `relaxedDurability` (the default) lets a COMMIT return before the write has
 * been flushed to IndexedDB, which is much faster but means committed data can
 * be lost in a crash. Pass false for a launch that cannot afford that.
 */
async function createWorkerInstance(relaxedDurability = true, key: CryptoKey | null = null): Promise<PGliteInterface> {
  // The native app's database is encrypted (#1361, #1364): the worker opens its own store with
  // this key instead of DATA_DIR.
  const options: Record<string, unknown> = {
    ...(key ? { key } : { dataDir: DATA_DIR }),
    // Forwarded to the worker's init(), which passes it to the engine.
    relaxedDurability,
    // Must differ from the pre-0.5 build's id: PGliteWorker derives its leader
    // election lock from it, so sharing one with an old-build tab would run our
    // queries — the restore included — against that tab's legacy data dir.
    id: 'journal-pglite-pg18',
    extensions: { live },
  };
  if (!currentWorker) {
    addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('freeze', onFreeze);
  }
  currentWorker = new Worker(new URL('./pglite-worker.ts', import.meta.url), { type: 'module' });
  // Android's encrypted open can take seconds on a large account: the splash shows how far it is (#1365).
  if (key && nativePlatform() === 'android') {
    startOpenProgress();
    currentWorker.addEventListener('message', (event: MessageEvent<{ type?: string; done: number; total: number }>) => {
      if (event.data?.type === 'journal-open-progress') reportOpenProgress(event.data.done, event.data.total);
    });
  }
  // The worker's boot timing marks (#901): reading the data dir from IndexedDB, and Postgres up.
  currentWorker.addEventListener('message', (event: MessageEvent<{ type?: string; step: string; at: number }>) => {
    if (event.data?.type === 'journal-boot-mark') markBoot(event.data.step, event.data.at - performance.timeOrigin);
  });
  const worker = currentWorker;
  workerOpenFailed = new Promise<never>((_, reject) => {
    worker.addEventListener('message', (event: MessageEvent<{ type?: string; name: string; message: string }>) => {
      if (event.data?.type !== 'journal-open-error') return;
      reject(Object.assign(new Error(event.data.message), { name: event.data.name }));
    });
  });
  // Handled where a boot waits on it; a failure nobody waits for must not be unhandled.
  workerOpenFailed.catch(() => {});
  return PGliteWorker.create(currentWorker, options).then((db) => {
    finishOpenProgress();
    // WASM fetched + compiled and the worker leader elected — the slowest
    // step of a cold boot, reported for the splash progress bar.
    reportBootPhase('db-worker');
    // Boot timing marks (#806): this tab's worker won the leader election, and the
    // leader accepted this tab. The leader accepts it before its engine has loaded:
    // db-idb-read, db-idb-loaded and db-open (from the worker) time that load (#901).
    if (db.isLeader) markBoot('db-leader');
    else db.onLeaderChange(() => { if (db.isLeader) markBoot('db-leader'); });
    void db.waitReady.then(() => markBoot('db-connected'));
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

/** A worker on the plain DATA_DIR, or with a key on the encrypted store, with the schema set up. */
async function openWorkerDatabase(key: CryptoKey | null): Promise<PGliteInterface> {
  const db = await createWorkerInstance(true, key);
  try {
    await Promise.race([initializeSchema(db), workerOpenFailed]);
  } catch (err) {
    // Don't leak the worker: a retry would add a second one.
    await db.close().catch(() => {});
    throw err;
  }
  return db;
}

/**
 * The native app's database, desktop and phone (#1361, #1362, #1364). A plain database an older build left is
 * deleted once the encrypted one is open, and so is the older Postgres 17 one, unread. If it has changes that never synced, this launch
 * runs on it instead, so the sync sends them first (isLeftoverSession). Its data is never
 * copied into the encrypted database, which starts empty and syncs from Homebase.
 */
async function openDesktopDatabase(): Promise<PGliteInterface> {
  let leftover = false;
  if (await databaseExists([PLAIN_DATABASE])) {
    let plain: PGliteInterface | null = null;
    try {
      plain = await openWorkerDatabase(null);
      const { countUnsyncedChanges } = await import('./queries/syncRecords');
      const unsynced = await countUnsyncedChanges(plain);
      if (unsynced > 0) {
        console.warn(`[DB] The plain database an older build left has ${unsynced} unsynced changes; opening it to sync them`);
        leftoverSession = true;
        return plain;
      }
      leftover = true;
    } catch (err) {
      // Its changes can't be counted, so it is kept. A later launch tries again.
      console.warn('[DB] Could not read the plain database an older build left; keeping it:', err);
    }
    await plain?.close().catch(() => {});
  }
  const db = await openWorkerDatabase(await loadDatabaseKey()).catch((err: unknown) => {
    // A wrong passphrase (#1363) asks again.
    if (usesPassphrase() && err instanceof Error && err.name === 'WrongKeyError') throw new PassphraseNeededError(false, true);
    throw err;
  });
  if (leftover) {
    const { deleteLocalDatabase } = await import('./localReset');
    deleteLocalDatabase(PLAIN_DATABASE).catch((err) => console.warn('[DB] Could not delete the plain database:', err));
  }
  // Its notes are on Homebase and this engine can't open it, so it is deleted without a sync.
  if (await databaseExists([LEGACY_DATABASE])) {
    const { deleteLocalDatabase } = await import('./localReset');
    deleteLocalDatabase(LEGACY_DATABASE).catch((err) => console.warn('[DB] Could not delete the legacy database:', err));
  }
  return db;
}

// The encrypted store can't be opened, so it is deleted (#1435): its notes are on Homebase.
const UNOPENABLE = ['DatabaseKeyMissingError', 'CorruptStoreError', 'WrongKeyError'];

/**
 * Android with encryption paused (#1435), #1362 in reverse. The app lock goes first, quietly:
 * it gates the database key. The encrypted store an older build left is opened once with its
 * key and its unsynced changes counted. With none, it is deleted with the sealed query cache
 * and the sealed unload copies of edits, and the plain database opens and fills through the
 * first sync. With some, this launch runs on it (isLeftoverSession), so the sync sends them.
 * A missing key or a store that won't open is deleted too; one whose changes can't be
 * counted is kept for a later launch. Nothing is copied. Null: open the plain database.
 */
async function leaveEncryptedStore(): Promise<PGliteInterface | null> {
  const stores = [`${ENCRYPTED_STORE}.a`, `${ENCRYPTED_STORE}.b`];
  const present = await databaseExists(stores);
  const { appLockOn } = await import('../native/bridge');
  if (present || appLockOn()) {
    const { setAppLock } = await import('../appLock');
    await setAppLock(false).catch((err: unknown) => console.warn('[DB] Could not turn the app lock off:', err));
  }
  if (!present) return null;
  let encrypted: PGliteInterface | null = null;
  try {
    encrypted = await openWorkerDatabase(await loadDatabaseKey(true));
    const { countUnsyncedChanges } = await import('./queries/syncRecords');
    const unsynced = await countUnsyncedChanges(encrypted);
    if (unsynced > 0) {
      console.warn(`[DB] The encrypted store an older build left has ${unsynced} unsynced changes; opening it to sync them`);
      leftoverSession = true;
      return encrypted;
    }
  } catch (err) {
    if (!(err instanceof Error && UNOPENABLE.includes(err.name))) {
      console.warn('[DB] Could not count the changes in the encrypted store an older build left; keeping it:', err);
      await encrypted?.close().catch(() => {});
      return null;
    }
    console.warn('[DB] The encrypted store an older build left can\'t be opened; deleting it:', err);
  }
  await encrypted?.close().catch(() => {});
  try {
    const { deleteLocalDatabase } = await import('./localReset');
    for (const name of stores) await deleteLocalDatabase(name);
    const { get, del } = await import('idb-keyval');
    const { QUERY_CACHE_KEY } = await import('../queryCache');
    if ((await get(QUERY_CACHE_KEY)) instanceof Uint8Array) await del(QUERY_CACHE_KEY);
    const { removeSealedCopies } = await import('../yjs/unsavedEdits');
    removeSealedCopies();
  } catch (err) {
    // A later launch tries again.
    console.warn('[DB] Could not delete the encrypted store an older build left:', err);
  }
  return null;
}

async function initDatabase(): Promise<PGliteInterface> {
  if (usesEncryptedDatabase()) return openDesktopDatabase();
  if (encryptionPaused()) {
    const leftover = await leaveEncryptedStore();
    if (leftover) return leftover;
  }
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
