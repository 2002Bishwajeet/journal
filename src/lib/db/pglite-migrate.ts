const VERSION_KEY = 'journal-pglite-version';
// Present when the legacy database must outlive the migration: its template1
// holds v0.3-era tables this migration didn't copy, or the user chose to open
// without them. Absent is NOT permission to delete — the write can simply have
// failed — so every delete re-checks template1 first.
const LEGACY_KEPT_KEY = 'journal-pglite-legacy-kept';
// Present when the user chose to open without their legacy data. Deliberately
// not the version stamp: the stamp would make this indistinguishable from a
// completed migration, and a later launch could never offer recovery.
const LEGACY_SKIP_KEY = 'journal-pglite-skip-legacy';
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

const PUBLIC_TABLE_COUNT_SQL = `SELECT COUNT(*)::int as cnt FROM information_schema.tables WHERE table_schema = 'public'`;

// The app's own data tables. A '0.4' stamp only proves initializeSchema ran
// against `postgres` — the shipped 0.4 build created the full empty schema
// there while v0.3 data stayed in template1 — so "is there anything here" has
// to be answered with rows, never with table count.
const DATA_TABLES = ['document_updates', 'search_index'];

/** SQL dump of a legacy database, and which database it came out of. */
export interface LegacyDump {
  sql: string;
  /** template1's contents are in this dump, so nothing is left there to protect. */
  fromTemplate1: boolean;
}

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

// localStorage throws in Safari private mode and on quota. These run before the
// version is stamped, so an unguarded access fails the boot on every launch.
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[PGlite Migration] Could not persist ${key}:`, err);
    return false;
  }
}

function clearLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export function getStoredPGliteVersion(): string | null {
  return readLocal(VERSION_KEY);
}

export function setStoredPGliteVersion(version: string): boolean {
  return writeLocal(VERSION_KEY, version);
}

function isLegacyKept(): boolean {
  return readLocal(LEGACY_KEPT_KEY) !== null;
}

/** Keeps the legacy database indefinitely. Returns false if that didn't persist. */
export function preserveLegacyDatabase(): boolean {
  return writeLocal(LEGACY_KEPT_KEY, 'kept');
}

export function legacyMigrationSkipped(): boolean {
  return readLocal(LEGACY_SKIP_KEY) !== null;
}

/** Records the user's choice to open without the legacy data. */
export function skipLegacyMigration(): boolean {
  return writeLocal(LEGACY_SKIP_KEY, 'skipped');
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
  // v0.3 and v0.4 are both Postgres 17, so the v0.4 engine opens a v0.3 data dir
  // directly and the v0.3 engine is never needed. v0.3 kept user tables in
  // `template1` rather than `postgres` (the v0.4 default), so a dir it wrote —
  // recognisable by the absent version stamp — is opened on that database.
  return openWithLegacyEngines(dataDir, storedVersion === null ? 'template1' : undefined);
}

type LegacyDatabase = Awaited<ReturnType<typeof openLegacyDatabase>>;

/**
 * How much is in a database: `rows` counts the app's data tables and is null
 * when none of them exist (a v0.3-era or foreign schema), where the table count
 * is all we have to go on.
 */
async function probePopulation(db: LegacyDatabase): Promise<{ tables: number; rows: number | null }> {
  const tableResult = await db.query(PUBLIC_TABLE_COUNT_SQL);
  const tables = Number((tableResult.rows[0] as { cnt: number }).cnt);

  const present: string[] = [];
  for (const table of DATA_TABLES) {
    const exists = await db.query(`SELECT to_regclass('public.${table}') IS NOT NULL AS present`);
    if ((exists.rows[0] as { present: boolean }).present) present.push(table);
  }
  if (present.length === 0) return { tables, rows: null };

  const sum = present.map((table) => `(SELECT count(*) FROM public.${table})`).join(' + ');
  const rowResult = await db.query(`SELECT (${sum})::int AS rows`);
  return { tables, rows: Number((rowResult.rows[0] as { rows: number }).rows) };
}

function holdsUserData(population: { tables: number; rows: number | null }): boolean {
  return population.rows !== null ? population.rows > 0 : population.tables > 0;
}

async function dumpDatabase(db: LegacyDatabase, database: string): Promise<string> {
  console.log(`[PGlite Migration] Dumping ${database}...`);
  const { pgDump } = await import('@electric-sql/pglite-tools/pg_dump');
  // pglite-tools types `pg` as the live engine's class; the legacy class is a
  // distinct TS type but exposes the same protocol API pg_dump uses.
  const file = await pgDump({ pg: db as unknown as Parameters<typeof pgDump>[0]['pg'], args: PG_DUMP_ARGS });
  return file.text();
}

/** Opens a legacy database, reports whether it holds notes, and dumps it. */
async function readDatabase(
  storedVersion: string | null,
  dataDir: string,
  database: string,
): Promise<{ hasData: boolean; dump: string | null }> {
  const db = await openLegacyDatabase(storedVersion, dataDir);
  try {
    const population = await probePopulation(db);
    return {
      hasData: holdsUserData(population),
      // Dump whenever there is anything at all, so a dir whose only content is
      // folders or app_state still comes across.
      dump: population.tables > 0 ? await dumpDatabase(db, database) : null,
    };
  } finally {
    await db.close();
  }
}

/**
 * SQL dump of a legacy data dir, or null when there is nothing in it.
 *
 * `postgres` comes first, so an ordinary 0.4 user is unaffected. When it holds
 * no notes we also look in `template1`: PGlite 0.3 kept user tables there, and
 * the shipped physical 0.3→0.4 migration never copied them across — it only ran
 * initializeSchema against `postgres`, which is why an empty schema there says
 * nothing about whether the user has data.
 *
 * Exported as a test seam; the app always passes the legacy IndexedDB dir.
 */
export async function dumpLegacyDataDir(storedVersion: string | null, dataDir: string): Promise<LegacyDump | null> {
  const primary = await readDatabase(storedVersion, dataDir, storedVersion === null ? 'template1' : 'postgres');

  // A v0.3 stamp opened template1 itself, so this dump already covers it.
  if (storedVersion === null) return primary.dump ? { sql: primary.dump, fromTemplate1: true } : null;
  if (primary.hasData && primary.dump) return { sql: primary.dump, fromTemplate1: false };

  const template1 = await openWithLegacyEngines(dataDir, 'template1');
  try {
    if (holdsUserData(await probePopulation(template1))) {
      console.warn('[PGlite Migration] Recovering v0.3-era data stranded in template1');
      return { sql: await dumpDatabase(template1, 'template1'), fromTemplate1: true };
    }
  } finally {
    await template1.close();
  }

  return primary.dump ? { sql: primary.dump, fromTemplate1: false } : null;
}

/**
 * Logical (pg_dump) SQL dump of the legacy database, for restoring into the
 * Postgres 18 engine — a physical dumpDataDir can't cross a major version.
 * `storedVersion` null means the v0.3 engine wrote it, '0.4' the v0.4 engine.
 * Resolves null when there is nothing to migrate.
 */
export async function dumpLegacyDatabase(storedVersion: string | null): Promise<LegacyDump | null> {
  // Detect without instantiating an engine. No leftover DB → nothing to migrate,
  // and none of the legacy engines (~10 MB WASM each) is imported on this path.
  if (!(await legacyDatabaseExists())) {
    console.log('[PGlite Migration] No legacy database found, skipping');
    return null;
  }

  let dump: LegacyDump | null;
  try {
    console.log(`[PGlite Migration] Legacy database detected (stored version ${storedVersion}), loading v0.4 engine...`);
    dump = await dumpLegacyDataDir(storedVersion, LEGACY_DATA_DIR);
    if (dump) console.log('[PGlite Migration] Dump complete');
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
  if (dump === null) await retireLegacyDatabase(storedVersion, false);
  return dump;
}

/**
 * Whether the legacy dir still holds v0.3-era tables in `template1` that this
 * migration has not copied. 'unknown' means the check itself failed — the
 * database is then kept, and checked again on a later launch.
 */
async function checkTemplate1(): Promise<'has-tables' | 'empty' | 'unknown'> {
  try {
    const db = await openWithLegacyEngines(LEGACY_DATA_DIR, 'template1');
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
 * Deletes the legacy database now that its data has been carried over.
 *
 * `dumpedTemplate1` says the dump already contains template1's contents, the
 * only case where deleting without checking is safe. Otherwise template1 is
 * re-checked here: a '0.4' dir can still hold v0.3-era tables that no dump has
 * taken, and that may be the only copy left.
 */
export async function retireLegacyDatabase(storedVersion: string | null, dumpedTemplate1 = false): Promise<void> {
  if (isLegacyKept()) return;
  if (storedVersion !== null && !dumpedTemplate1) {
    const template1 = await checkTemplate1();
    if (template1 === 'has-tables') {
      console.warn(
        '[PGlite Migration] Keeping the legacy database: its template1 still holds v0.3-era tables that this migration does not copy',
      );
      preserveLegacyDatabase();
      return;
    }
    if (template1 === 'unknown') {
      console.warn('[PGlite Migration] Keeping the legacy database until template1 can be checked again');
      return;
    }
  }
  await deleteLegacyDatabase();
}

/**
 * Second-chance delete, for launches that are already migrated. During the
 * migration itself the delete is blocked by this tab's own IndexedDB connection
 * to the legacy database (PGlite's IDBFS never closes it), so the database
 * survives the session; a later launch never opens it.
 */
export async function cleanUpLegacyDatabase(): Promise<void> {
  if (isLegacyKept()) return;
  if (!(await legacyDatabaseExists())) return;

  // A missing keep flag is not permission to delete — the write may have failed
  // — so the data itself decides. This is the only path that loads an engine
  // after migrating, and only while a leftover database is still around.
  const template1 = await checkTemplate1();
  if (template1 === 'has-tables') {
    preserveLegacyDatabase();
    return;
  }
  if (template1 === 'unknown') return;

  console.log('[PGlite Migration] Deleting the legacy database left behind by an earlier migration');
  await deleteLegacyDatabase();
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
  clearLocal(LEGACY_KEPT_KEY);
}
