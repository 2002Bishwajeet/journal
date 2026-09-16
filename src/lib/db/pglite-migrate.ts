const VERSION_KEY = 'journal-pglite-version';
// Whether the legacy database must outlive the migration.
//   'kept'    — its template1 holds v0.3-era tables this migration didn't copy,
//               or the user chose to boot without them: never delete it.
//   'recheck' — the template1 check itself failed, so a later launch has to
//               decide before deleting. A transient failure must not pin tens
//               of MB of IndexedDB forever, nor license a blind delete.
const LEGACY_KEPT_KEY = 'journal-pglite-legacy-kept';
// Data dir of the retired PGlite engines (v0.3 and v0.4, both Postgres 17). The
// live engine (Postgres 18) uses a different dir — see DATA_DIR in pglite.ts.
const LEGACY_DATA_DIR = 'idb://journal-db';

// IndexedDB database names used by the retired engines. Both detection and
// deletion key off these — see legacyDatabaseExists() and deleteLegacyDatabase().
const LEGACY_DB_NAMES = ['/pglite/journal-db', 'journal-db'];

// --clean makes the restore drop-and-recreate every object it contains, so a
// restore retried after a partially failed session (the new DB already has
// initializeSchema's tables) self-heals instead of failing on "already exists".
export const PG_DUMP_ARGS = ['--clean', '--if-exists'];

// What PGlite throws when Postgres refuses a data dir, e.g. one written by a
// different major version.
const INIT_FAILED_MESSAGE = 'PGlite failed to initialize properly';

const PUBLIC_TABLE_COUNT_SQL = `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = 'public'`;

// Set when this launch's dump came out of `template1`: that data is being
// migrated, so retireLegacyDatabase must not keep the database on its account.
let dumpedTemplate1 = false;

/**
 * Thrown when a legacy database is present but dumping it failed. Signals the
 * caller NOT to stamp the stored PGlite version, so the migration is retried on
 * the next launch instead of silently stranding the user's data behind a fresh
 * empty database.
 */
export class LegacyMigrationError extends Error {
  constructor(cause: unknown) {
    super('[PGlite Migration] legacy database present but dump failed');
    this.name = 'LegacyMigrationError';
    (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Cheap check for a leftover legacy database that does NOT load any engine.
 * Prefers indexedDB.databases(); falls back (older Safari, which lacks it) to
 * probing each name with open()/onupgradeneeded — that event fires only when the
 * DB did not already exist, so any empty shell the probe creates is deleted.
 */
async function legacyDatabaseExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases === 'function') {
    const names = (await indexedDB.databases()).map((d) => d.name);
    return LEGACY_DB_NAMES.some((name) => names.includes(name));
  }
  for (const name of LEGACY_DB_NAMES) {
    const outcome = await new Promise<'existed' | 'created' | 'error'>((resolve) => {
      let createdNow = false;
      const req = indexedDB.open(name);
      req.onupgradeneeded = () => {
        createdNow = true;
      };
      req.onsuccess = () => {
        req.result.close();
        resolve(createdNow ? 'created' : 'existed');
      };
      req.onerror = () => resolve('error');
    });
    if (outcome === 'existed') return true;
    // The probe created an empty shell — remove it so we don't leave one behind.
    if (outcome === 'created') indexedDB.deleteDatabase(name);
  }
  return false;
}

export function getStoredPGliteVersion(): string | null {
  return localStorage.getItem(VERSION_KEY);
}

export function setStoredPGliteVersion(version: string) {
  localStorage.setItem(VERSION_KEY, version);
}

// localStorage throws in private mode and on quota; these run before the
// version is stamped, so an unguarded write would fail the boot every launch.
function readLegacyKeptState(): 'kept' | 'recheck' | null {
  try {
    const value = localStorage.getItem(LEGACY_KEPT_KEY);
    return value === 'kept' || value === 'recheck' ? value : null;
  } catch {
    return null;
  }
}

function writeLegacyKeptState(state: 'kept' | 'recheck' | null): void {
  try {
    if (state) localStorage.setItem(LEGACY_KEPT_KEY, state);
    else localStorage.removeItem(LEGACY_KEPT_KEY);
  } catch (err) {
    console.warn('[PGlite Migration] Could not record the legacy database state:', err);
  }
}

/** Keeps the legacy database indefinitely (the boot screen's opt-out uses this). */
export function preserveLegacyDatabase(): void {
  writeLegacyKeptState('kept');
}

/**
 * Opens a Postgres 17 data dir with the v0.4 engine, falling back to the current
 * engine when the dir turns out to be Postgres 18 (fresh installs made while
 * PGlite 0.5 ran against the legacy dir, before this upgrade path existed).
 */
async function openWithLegacyEngines(dataDir: string, database?: string) {
  const { PGlite: PGliteV4 } = await import('pglite-v4');
  const { pg_trgm } = await import('pglite-v4/contrib/pg_trgm');

  try {
    return await PGliteV4.create(dataDir, { database, extensions: { pg_trgm } });
  } catch (err) {
    if (!(err instanceof Error && err.message === INIT_FAILED_MESSAGE)) throw err;
    console.warn('[PGlite Migration] v0.4 engine refused the legacy dir; retrying with the current engine');
    const { PGlite } = await import('@electric-sql/pglite');
    const { pg_trgm: currentPgTrgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    return PGlite.create(dataDir, { database, extensions: { pg_trgm: currentPgTrgm } });
  }
}

/**
 * Opens the legacy database in `dataDir` with an engine pg_dump can drive.
 * Exported as a test seam; the app always passes the legacy IndexedDB dir.
 */
export async function openLegacyDatabase(storedVersion: string | null, dataDir: string) {
  if (storedVersion === null) {
    // pg_dump can't drive the v0.3 engine (it lacks the streaming protocol API),
    // but v0.3 and v0.4 are both Postgres 17: copy the data dir into an
    // in-memory v0.4 engine. v0.3 kept user tables in `template1`, not in
    // `postgres` (the v0.4 default), so open that database explicitly.
    const { PGlite: PGliteV4 } = await import('pglite-v4');
    const { pg_trgm } = await import('pglite-v4/contrib/pg_trgm');
    const { PGlite: PGliteV3 } = await import('pglite-v3');
    const v3Db = new PGliteV3(dataDir);
    await v3Db.waitReady;
    const tarball = await v3Db.dumpDataDir('none');
    await v3Db.close();
    return PGliteV4.create({ loadDataDir: tarball, database: 'template1', extensions: { pg_trgm } });
  }

  return openWithLegacyEngines(dataDir, undefined);
}

type LegacyDatabase = Awaited<ReturnType<typeof openLegacyDatabase>>;

/** Dumps `db`, or resolves null when it holds no user tables at all. */
async function dumpIfPopulated(db: LegacyDatabase, database: string): Promise<string | null> {
  const result = await db.query(PUBLIC_TABLE_COUNT_SQL);
  const tableCount = Number((result.rows[0] as { cnt: number }).cnt);
  if (tableCount === 0) return null;

  console.log(`[PGlite Migration] Found ${tableCount} tables in ${database}, dumping data...`);
  const { pgDump } = await import('@electric-sql/pglite-tools/pg_dump');
  // pglite-tools types `pg` as the live engine's class; the legacy class is a
  // distinct TS type but exposes the same protocol API pg_dump uses.
  const file = await pgDump({ pg: db as unknown as Parameters<typeof pgDump>[0]['pg'], args: PG_DUMP_ARGS });
  return file.text();
}

/**
 * SQL dump of a legacy data dir, or null when there is nothing in it.
 *
 * A '0.4' dir normally keeps user tables in `postgres`. When that database is
 * empty we also look in `template1`: PGlite 0.3 kept user tables there, and the
 * shipped physical 0.3→0.4 migration never copied them across, so for those
 * users the notes are still sitting in template1 and this is their only chance
 * to come along.
 *
 * Exported as a test seam; the app always passes the legacy IndexedDB dir.
 */
export async function dumpLegacyDataDir(storedVersion: string | null, dataDir: string): Promise<string | null> {
  const oldDb = await openLegacyDatabase(storedVersion, dataDir);
  let dump: string | null;
  try {
    dump = await dumpIfPopulated(oldDb, storedVersion === null ? 'template1' : 'postgres');
  } finally {
    await oldDb.close();
  }
  if (dump !== null || storedVersion === null) return dump;

  const template1Db = await openWithLegacyEngines(dataDir, 'template1');
  try {
    dump = await dumpIfPopulated(template1Db, 'template1');
  } finally {
    await template1Db.close();
  }
  if (dump !== null) {
    console.warn('[PGlite Migration] Recovered v0.3-era data stranded in template1');
    dumpedTemplate1 = true;
  }
  return dump;
}

/**
 * Logical (pg_dump) SQL dump of the legacy database, for restoring into the
 * Postgres 18 engine — a physical dumpDataDir can't cross a major version.
 * `storedVersion` null means the v0.3 engine wrote it, '0.4' the v0.4 engine.
 * Resolves null when there is nothing to migrate.
 */
export async function dumpLegacyDatabase(storedVersion: string | null): Promise<string | null> {
  // Detect without instantiating an engine. No leftover DB → nothing to migrate,
  // and none of the legacy engines (~10 MB WASM each) is imported on this path.
  if (!(await legacyDatabaseExists())) {
    console.log('[PGlite Migration] No legacy database found, skipping');
    return null;
  }

  let dump: string | null;
  try {
    console.log(`[PGlite Migration] Legacy database detected (stored version ${storedVersion}), loading v0.4 engine...`);
    dump = await dumpLegacyDataDir(storedVersion, LEGACY_DATA_DIR);
    if (dump !== null) console.log('[PGlite Migration] Dump complete');
  } catch (err) {
    // A legacy DB is present but we couldn't dump it. Surface a tagged error so
    // the caller can skip version-stamping and retry next launch, rather than
    // stranding the user's data behind a fresh empty database.
    console.error('[PGlite Migration] Legacy database present but dump failed:', err);
    throw new LegacyMigrationError(err);
  }

  // Nothing to carry over, so retire it now rather than leave it for every
  // future launch to find. The engine is closed, so we don't block our own
  // delete.
  if (dump === null) await retireLegacyDatabase(storedVersion);
  return dump;
}

/**
 * Whether the legacy dir still holds v0.3-era tables in `template1` that this
 * migration has not copied. 'unknown' means the check itself failed — the
 * database is then kept, but only provisionally.
 */
async function checkTemplate1(dataDir: string): Promise<'has-tables' | 'empty' | 'unknown'> {
  try {
    const db = await openWithLegacyEngines(dataDir, 'template1');
    try {
      const result = await db.query(PUBLIC_TABLE_COUNT_SQL);
      return Number((result.rows[0] as { cnt: number }).cnt) > 0 ? 'has-tables' : 'empty';
    } finally {
      await db.close();
    }
  } catch (err) {
    console.warn('[PGlite Migration] Could not check template1 for v0.3-era tables:', err);
    return 'unknown';
  }
}

/**
 * Deletes the legacy database now that its data has been carried over — unless
 * a '0.4' dir still holds v0.3-era tables in `template1` that this migration
 * did not dump, where it may be the only copy left.
 */
export async function retireLegacyDatabase(storedVersion: string | null): Promise<void> {
  // A v0.3 stamp dumps template1 itself, and so does the fallback above, so in
  // both cases there is nothing left in template1 to protect.
  if (storedVersion !== null && !dumpedTemplate1) {
    const template1 = await checkTemplate1(LEGACY_DATA_DIR);
    if (template1 === 'has-tables') {
      console.warn(
        '[PGlite Migration] Keeping the legacy database: its template1 still holds v0.3-era tables that this migration does not copy',
      );
      writeLegacyKeptState('kept');
      return;
    }
    if (template1 === 'unknown') {
      console.warn('[PGlite Migration] Keeping the legacy database until template1 can be checked again');
      writeLegacyKeptState('recheck');
      return;
    }
  }
  await deleteLegacyDatabase();
  writeLegacyKeptState(null);
}

/**
 * Second-chance delete, for launches that are already migrated. During the
 * migration itself the delete is blocked by this tab's own IndexedDB connection
 * to the legacy database (PGlite's IDBFS never closes it), so the database
 * survives the session; a later launch never opens it.
 */
export async function cleanUpLegacyDatabase(): Promise<void> {
  const state = readLegacyKeptState();
  if (state === 'kept') return;
  if (!(await legacyDatabaseExists())) {
    if (state) writeLegacyKeptState(null);
    return;
  }
  if (state === 'recheck') {
    // The migration couldn't check template1, so decide now instead of deleting
    // data blind. This is the only path that loads an engine after migrating.
    const template1 = await checkTemplate1(LEGACY_DATA_DIR);
    if (template1 === 'has-tables') {
      writeLegacyKeptState('kept');
      return;
    }
    if (template1 === 'unknown') return;
  }
  console.log('[PGlite Migration] Deleting the legacy database left behind by an earlier migration');
  await deleteLegacyDatabase();
  writeLegacyKeptState(null);
}

async function deleteLegacyDatabase(): Promise<void> {
  for (const name of LEGACY_DB_NAMES) {
    try {
      const req = indexedDB.deleteDatabase(name);
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => {
          console.warn(`[PGlite Migration] Delete blocked for ${name}`);
          resolve();
        };
      });
    } catch {
      // Database might not exist
    }
  }
}
