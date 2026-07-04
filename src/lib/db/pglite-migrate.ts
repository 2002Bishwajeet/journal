const VERSION_KEY = 'journal-pglite-version';
const DATA_DIR = 'idb://journal-db';

// IndexedDB database names used by the retired PGlite v0.3 engine. Both detection
// and deletion key off these — see v3DatabaseExists() and deleteV3Database().
const V3_DB_NAMES = ['/pglite/journal-db', 'journal-db'];

/**
 * Thrown when a v0.3 database is present but dumping it failed. Signals the
 * caller NOT to stamp the stored PGlite version, so the migration is retried on
 * the next launch instead of silently stranding the user's data behind a fresh
 * empty database.
 */
export class V3MigrationError extends Error {
  constructor(cause: unknown) {
    super('[PGlite Migration] v0.3 database present but dump failed');
    this.name = 'V3MigrationError';
    (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Cheap check for a leftover v0.3 database that does NOT load the v3 engine.
 * Prefers indexedDB.databases(); falls back (older Safari, which lacks it) to
 * probing each name with open()/onupgradeneeded — that event fires only when the
 * DB did not already exist, so any empty shell the probe creates is deleted.
 */
async function v3DatabaseExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases === 'function') {
    const names = (await indexedDB.databases()).map((d) => d.name);
    return V3_DB_NAMES.some((name) => names.includes(name));
  }
  for (const name of V3_DB_NAMES) {
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


export async function migrateFromV3(): Promise<Blob | null> {
  // Detect without instantiating the v3 engine. No leftover DB → nothing to
  // migrate, and the ~13 MB v3 WASM engine is never imported on this path.
  if (!(await v3DatabaseExists())) {
    console.log('[PGlite Migration] No v0.3 database found, skipping');
    return null;
  }

  try {
    console.log('[PGlite Migration] v0.3 database detected, loading v3 engine...');
    const { PGlite: PGliteV3 } = await import('pglite-v3');
    const oldDb = new PGliteV3(DATA_DIR);
    await oldDb.waitReady;

    const testResult = await oldDb.query('SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = \'public\'');
    const tableCount = (testResult.rows[0] as { cnt: number }).cnt;

    if (tableCount === 0) {
      console.log('[PGlite Migration] v0.3 database is empty, skipping');
      await oldDb.close();
      return null;
    }

    console.log(`[PGlite Migration] Found ${tableCount} tables, dumping data...`);
    const dump = await oldDb.dumpDataDir('none');
    await oldDb.close();
    console.log('[PGlite Migration] Dump complete');
    return dump as Blob;
  } catch (err) {
    // A v0.3 DB is present but we couldn't dump it. Surface a tagged error so the
    // caller can skip version-stamping and retry next launch, rather than
    // stranding the user's data behind a fresh empty database.
    console.error('[PGlite Migration] v0.3 database present but dump failed:', err);
    throw new V3MigrationError(err);
  }
}

export async function deleteV3Database(): Promise<void> {
  const dbNames = [
    '/pglite/journal-db',
    'journal-db',
  ];
  for (const name of dbNames) {
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
