import { PGlite as PGliteV3 } from 'pglite-v3';

const VERSION_KEY = 'journal-pglite-version';
const DATA_DIR = 'idb://journal-db';

export function getStoredPGliteVersion(): string | null {
  return localStorage.getItem(VERSION_KEY);
}

export function setStoredPGliteVersion(version: string) {
  localStorage.setItem(VERSION_KEY, version);
}


export async function migrateFromV3(): Promise<Blob | null> {
  try {
    console.log('[PGlite Migration] Checking for v0.3 database...');
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
  } catch {
    console.log('[PGlite Migration] No v0.3 database found, skipping');
    return null;
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
