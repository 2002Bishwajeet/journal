/**
 * The app's database schema: the base tables (initializeSchema), the migration
 * chain (runMigrations) and the lazily enabled trigram search SQL.
 *
 * A separate module (not pglite.ts) so the test database builds the same schema
 * without pulling in the worker/boot code. Must not import ./pglite.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import { MAIN_FOLDER_ID } from '../homebase/config';
import { SYNC_ERRORS_ACTIVE_INDEX_SQL } from './syncErrorsSchema';

// Bump whenever a new statement is added to runMigrations().
export const SCHEMA_VERSION = '5';

// pg_trgm and its GIN indexes. Run on demand by ensureTrigramSearch() in
// pglite.ts, not at boot (loading the extension costs ~1–2s).
export const TRIGRAM_SEARCH_SQL = `
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_search_title_trgm ON search_index USING GIN(title gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_search_content_trgm ON search_index USING GIN(plain_text_content gin_trgm_ops);
`;

export async function initializeSchema(database: PGliteInterface): Promise<void> {
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

  // Dedupe existing unresolved sync_errors rows and enforce one active row per
  // (entity_id, operation) going forward, so recordSyncError can upsert with backoff (#146).
  try {
    await database.exec(SYNC_ERRORS_ACTIVE_INDEX_SQL);
    console.log('[DB Migration] sync_errors active index ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not create sync_errors active index:', error);
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

  // Version history: full-state snapshots taken before compaction (#158). Local only.
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS document_snapshots (
        id SERIAL PRIMARY KEY,
        doc_id UUID NOT NULL,
        state_blob BYTEA NOT NULL,
        state_vector BYTEA NOT NULL,
        preview TEXT NOT NULL DEFAULT '',
        word_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_doc_created ON document_snapshots (doc_id, created_at DESC);
    `);
  } catch (error) {
    console.warn('[DB Migration] Could not create document_snapshots table:', error);
  }
}
