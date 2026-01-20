import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { MAIN_FOLDER_ID } from '../homebase';

let db: PGlite | null = null;

export async function getDatabase(): Promise<PGlite> {
  if (db) return db;

  console.log('[DB] Creating new PGlite instance...');
  db = new PGlite('idb://journal-db', {
    extensions: { pg_trgm }
  });

  // Wait for PGlite to be ready
  await db.waitReady;
  console.log('[DB] PGlite ready, initializing schema...');

  await initializeSchema(db);
  console.log('[DB] Schema initialized');

  return db;
}

async function initializeSchema(database: PGlite): Promise<void> {
  console.log('[DB Schema] Starting schema initialization...');

  // Enable pg_trgm extension for fuzzy/trigram matching
  // This must happen BEFORE any queries that use it
  try {
    await database.exec(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    console.log('[DB Schema] pg_trgm extension enabled');
  } catch (error) {
    console.warn('[DB Schema] Could not enable pg_trgm:', error);
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
      encrypted_key_header TEXT
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
  `);

  console.log('[DB Schema] Base tables created');

  // Run migrations for existing databases
  await runMigrations(database);
}

async function runMigrations(database: PGlite): Promise<void> {
  console.log('[DB Migration] Starting migrations...');

  // Ensure pg_trgm extension is enabled (for existing dbs)
  try {
    await database.exec(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    console.log('[DB Migration] pg_trgm extension enabled');
  } catch (error) {
    console.warn('[DB Migration] Could not enable pg_trgm extension:', error);
  }

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

  // Create GIN index for trigram similarity on title
  try {
    await database.exec(`
      CREATE INDEX IF NOT EXISTS idx_search_title_trgm 
      ON search_index USING GIN(title gin_trgm_ops);
    `);
    console.log('[DB Migration] Title trigram index ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not create title trigram index:', error);
  }

  // Create GIN index for trigram similarity on content
  try {
    await database.exec(`
      CREATE INDEX IF NOT EXISTS idx_search_content_trgm 
      ON search_index USING GIN(plain_text_content gin_trgm_ops);
    `);
    console.log('[DB Migration] Content trigram index ensured');
  } catch (error) {
    console.warn('[DB Migration] Could not create content trigram index:', error);
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
        encrypted_key_header TEXT
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
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
