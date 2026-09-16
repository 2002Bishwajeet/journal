import { PGliteWorker } from '@electric-sql/pglite/worker';
import type { PGliteInterface } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import type { PGliteWithLive } from '@electric-sql/pglite/live';
import { MAIN_FOLDER_ID } from '../homebase';
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
} from './pglite-migrate';

// PGlite 0.5 runs Postgres 18, which can't open the Postgres 17 data dir the
// older engines left at 'idb://journal-db'. Using a new dir lets the legacy DB
// survive until its data has been restored here (see initDatabase).
const DATA_DIR = 'idb://journal-db-pg18';
const PGLITE_VERSION = '0.5';
// Marks this data dir as already carrying the legacy data. The version stamp
// alone can't: anything that resets it (an old-build tab, a rollback, two new
// tabs racing) would otherwise --clean a stale dump over the migrated data.
const MIGRATION_MARKER_TABLE = 'pglite_legacy_migrated';
// Bump whenever a new statement is added to runMigrations().
const SCHEMA_VERSION = '3';

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
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        CREATE INDEX IF NOT EXISTS idx_search_title_trgm ON search_index USING GIN(title gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_search_content_trgm ON search_index USING GIN(plain_text_content gin_trgm_ops);
      `);
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

async function initDatabase(): Promise<PGliteInterface> {
  const storedVersion = getStoredPGliteVersion();
  // The user chose to open without their legacy data; it stays on disk,
  // unmigrated, until a future launch can offer it back.
  const skipped = legacyMigrationSkipped();

  if (storedVersion !== PGLITE_VERSION && !skipped) {
    let dump: Awaited<ReturnType<typeof dumpLegacyDatabase>>;
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

async function initializeSchema(database: PGliteInterface): Promise<void> {
  console.log('[DB Schema] Starting schema initialization...');

  // NOTE: pg_trgm is no longer enabled here — loading it costs ~1–2s and nothing
  // on the boot path uses trigram matching. It's enabled lazily on first search
  // via ensureTrigramSearch().

  // The applied schema revision lives INSIDE the database (not localStorage) so
  // it can never desync from the schema it guards: if the data dir is wiped or
  // evicted, this marker is gone too and full setup re-runs. Once a revision is
  // applied we skip BOTH the base-table DDL and the migration chain — they're
  // idempotent, but re-running them costs several hundred ms on every launch.
  // Bump SCHEMA_VERSION to force a re-run after a schema change.
  await database.exec(
    `CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, version TEXT NOT NULL);`,
  );
  const applied = await database.query<{ version: string }>(
    `SELECT version FROM schema_meta WHERE id = 1`,
  );
  if (applied.rows[0]?.version === SCHEMA_VERSION) {
    console.log('[DB Schema] Schema up to date, skipping schema setup');
    return;
  }

  await database.exec(`
    -- Create document_updates table (Yjs source of truth)
    CREATE TABLE IF NOT EXISTS document_updates (
      id SERIAL PRIMARY KEY,
      doc_id UUID NOT NULL,
      update_blob BYTEA NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_document_updates_doc_id 
    ON document_updates(doc_id);

    -- Create search_index table (derived state for FTS)
    CREATE TABLE IF NOT EXISTS search_index (
      doc_id UUID PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      plain_text_content TEXT DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}',
      vector_embedding REAL[],
      search_vector tsvector,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_search_index_title 
    ON search_index(title);

    -- Create folders table
    CREATE TABLE IF NOT EXISTS folders (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Create job_queue table for background tasks
    CREATE TABLE IF NOT EXISTS job_queue (
      id SERIAL PRIMARY KEY,
      job_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP WITH TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS idx_job_queue_status 
    ON job_queue(status);

    -- Create app_state table for session persistence
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Create sync_records table for local ↔ remote mapping
    CREATE TABLE IF NOT EXISTS sync_records (
      local_id UUID PRIMARY KEY,
      entity_type TEXT NOT NULL,
      remote_file_id TEXT,
      version_tag TEXT,
      last_synced_at TIMESTAMP WITH TIME ZONE,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      content_hash TEXT,
      encrypted_key_header TEXT,
      author_odin_id TEXT,
      global_transit_id TEXT,
      dirty_generation INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sync_records_status ON sync_records(sync_status);
    CREATE INDEX IF NOT EXISTS idx_sync_records_type ON sync_records(entity_type);

    -- Create pending_image_uploads table for retry queue
    CREATE TABLE IF NOT EXISTS pending_image_uploads (
      id UUID PRIMARY KEY,
      note_doc_id UUID NOT NULL,
      blob_data BYTEA NOT NULL,
      content_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      payload_key TEXT,
      next_retry_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_pending_uploads_status ON pending_image_uploads(status);
    CREATE INDEX IF NOT EXISTS idx_pending_uploads_note ON pending_image_uploads(note_doc_id);

    -- Create sync_errors table for tracking sync failures
    CREATE TABLE IF NOT EXISTS sync_errors (
      id SERIAL PRIMARY KEY,
      entity_id UUID NOT NULL,
      entity_type TEXT NOT NULL,
      operation TEXT NOT NULL,
      error_message TEXT NOT NULL,
      error_code TEXT,
      retry_count INTEGER DEFAULT 0,
      next_retry_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP WITH TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS idx_sync_errors_entity ON sync_errors(entity_id);
    CREATE INDEX IF NOT EXISTS idx_sync_errors_unresolved ON sync_errors(resolved_at) WHERE resolved_at IS NULL;

    -- Insert Main folder if not exists
    INSERT INTO folders (id, name)
    VALUES ('${MAIN_FOLDER_ID}', 'Main')
    ON CONFLICT (id) DO NOTHING;

    -- Create pending_image_deletions table for tracking image payloads to delete
    CREATE TABLE IF NOT EXISTS pending_image_deletions (
      id SERIAL PRIMARY KEY,
      note_doc_id UUID NOT NULL,
      payload_key TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(note_doc_id, payload_key)
    );
    CREATE INDEX IF NOT EXISTS idx_pending_deletions_note ON pending_image_deletions(note_doc_id);
  `);

  console.log('[DB Schema] Base tables created');

  await runMigrations(database);
  await database.query(
    `INSERT INTO schema_meta (id, version) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET version = $1`,
    [SCHEMA_VERSION],
  );
}

async function runMigrations(database: PGliteInterface): Promise<void> {
  console.log('[DB Migration] Starting migrations...');

  // pg_trgm and its trigram indexes are enabled lazily on first search via
  // ensureTrigramSearch() — intentionally not created here.

  // Add vector_embedding column if it doesn't exist
  try {
    await database.exec(`
      ALTER TABLE search_index ADD COLUMN IF NOT EXISTS vector_embedding REAL[];
    `);
    console.log('[DB Migration] vector_embedding column ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not add vector_embedding column:', error);
  }

  // Add search_vector column for FTS if it doesn't exist
  try {
    await database.exec(`
      ALTER TABLE search_index ADD COLUMN IF NOT EXISTS search_vector tsvector;
    `);
    console.log('[DB Migration] search_vector column ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not add search_vector column:', error);
  }

  // Create GIN index for full-text search
  try {
    await database.exec(`
      CREATE INDEX IF NOT EXISTS idx_search_fts 
      ON search_index USING GIN(search_vector);
    `);
    console.log('[DB Migration] FTS GIN index ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not create FTS index:', error);
  }

  // Drop any pre-existing trigram indexes. They're now created lazily on first
  // search (ensureTrigramSearch); leaving them would force every search_index
  // write to load pg_trgm at boot, defeating the deferral. DROP doesn't need the
  // extension loaded, and on a fresh db these are no-ops.
  try {
    await database.exec(`DROP INDEX IF EXISTS idx_search_title_trgm;`);
    await database.exec(`DROP INDEX IF EXISTS idx_search_content_trgm;`);
    console.log('[DB Migration] Legacy trigram indexes dropped (now lazy)');
  } catch (error) {
    console.warn('[DB Migration] Could not drop legacy trigram indexes:', error);
  }

  // Create BTREE expression index on metadata folderId for folder filtering
  try {
    await database.exec(`
        CREATE INDEX IF NOT EXISTS idx_search_metadata_folderid
        ON search_index ((metadata->>'folderId'));
    `);
    console.log('[DB Migration] Metadata folderId index ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not create metadata folderId index:', error);
  }

  // BTREE expression index on the modified timestamp so MODIFIED_DESC note
  // lists and the `[[` picker read in index order instead of seq-scan + sort.
  // Indexes the raw ISO-8601 text; must match MODIFIED_DESC in queries.ts.
  try {
    await database.exec(`
        CREATE INDEX IF NOT EXISTS idx_search_metadata_modified
        ON search_index ((metadata->'timestamps'->>'modified') DESC NULLS LAST);
    `);
    console.log('[DB Migration] Metadata modified index ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not create metadata modified index:', error);
  }

  // Populate search_vector for existing documents that don't have it
  try {
    await database.exec(`
      UPDATE search_index 
      SET search_vector = 
        setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(plain_text_content, '')), 'B')
      WHERE search_vector IS NULL;
    `);
    console.log('[DB Migration] Populated search_vector for existing documents');
  } catch (error) {
    console.warn('[DB Migration] Could not populate search_vector:', error);
  }

  console.log('[DB Migration] Migrations complete');

  // Create job_queue if not exists (for existing dbs)
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS job_queue (
        id SERIAL PRIMARY KEY,
        job_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP WITH TIME ZONE
      );
      CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status);
    `);
  } catch {
    // Table might already exist
  }

  // Create app_state if not exists (for existing dbs)
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch {
    // Table might already exist
  }

  // Create sync_records if not exists (for existing dbs)
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS sync_records (
        local_id UUID PRIMARY KEY,
        entity_type TEXT NOT NULL,
        remote_file_id TEXT,
        version_tag TEXT,
        last_synced_at TIMESTAMP WITH TIME ZONE,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        content_hash TEXT,
        encrypted_key_header TEXT,
        author_odin_id TEXT,
        global_transit_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_records_status ON sync_records(sync_status);
      CREATE INDEX IF NOT EXISTS idx_sync_records_type ON sync_records(entity_type);
    `);
  } catch {
    // Table might already exist
  }

  // Add content_hash column if it doesn't exist
  try {
    await database.exec(`
      ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS content_hash TEXT;
    `);
    console.log('[DB Migration] content_hash column ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not add content_hash column:', error);
  }

  // Add encrypted_key_header column if it doesn't exist (for version conflict optimization)
  try {
    await database.exec(`
      ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS encrypted_key_header TEXT;
    `);
    console.log('[DB Migration] encrypted_key_header column ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not add encrypted_key_header column:', error);
  }

  // Add collaboration peer tracking columns for sync_records
  try {
    await database.exec(`
      ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS author_odin_id TEXT;
      ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS global_transit_id TEXT;
    `);
    console.log('[DB Migration] collaboration peer columns ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not add collaboration peer columns:', error);
  }

  // Add dirty_generation column — autosave generation guard so a slow push cannot
  // clobber a 'pending' status set by an edit made during the push (plan 004).
  try {
    await database.exec(`
      ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS dirty_generation INTEGER NOT NULL DEFAULT 0;
    `);
    console.log('[DB Migration] dirty_generation column ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not add dirty_generation column:', error);
  }

  // Create pending_image_uploads if not exists (for existing dbs)
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS pending_image_uploads (
        id UUID PRIMARY KEY,
        note_doc_id UUID NOT NULL,
        blob_data BYTEA NOT NULL,
        content_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        payload_key TEXT,
        next_retry_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_pending_uploads_status ON pending_image_uploads(status);
      CREATE INDEX IF NOT EXISTS idx_pending_uploads_note ON pending_image_uploads(note_doc_id);
    `);
  } catch {
    // Table might already exist
  }

  // Add next_retry_at column if it doesn't exist
  try {
    await database.exec(`
      ALTER TABLE pending_image_uploads ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE;
    `);
  } catch {
    // Column might already exist
  }

  // Create sync_errors table if not exists (for existing dbs)
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS sync_errors (
        id SERIAL PRIMARY KEY,
        entity_id UUID NOT NULL,
        entity_type TEXT NOT NULL,
        operation TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_code TEXT,
        retry_count INTEGER DEFAULT 0,
        next_retry_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP WITH TIME ZONE
      );
      CREATE INDEX IF NOT EXISTS idx_sync_errors_entity ON sync_errors(entity_id);
      CREATE INDEX IF NOT EXISTS idx_sync_errors_unresolved ON sync_errors(resolved_at) WHERE resolved_at IS NULL;
    `);
  } catch {
    // Table might already exist
  }

  // Create pending_image_deletions if not exists (for existing dbs)
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS pending_image_deletions (
        id SERIAL PRIMARY KEY,
        note_doc_id UUID NOT NULL,
        payload_key TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(note_doc_id, payload_key)
      );
      CREATE INDEX IF NOT EXISTS idx_pending_deletions_note ON pending_image_deletions(note_doc_id);
    `);
  } catch {
    // Table might already exist
  }
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
