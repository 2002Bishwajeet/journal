/**
 * Test database setup utilities
 * Creates an in-memory PGlite database for testing
 */
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { PGlite } from '@electric-sql/pglite';

let testDb: PGlite | null = null;

/**
 * Create a fresh in-memory database for testing
 * This avoids mocking and tests real database operations
 */
export async function createTestDatabase(): Promise<PGlite> {
  // Use in-memory database for tests
  testDb = new PGlite();

  // Initialize schema (same as pglite.ts but without the singleton)
  await testDb.exec(`
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
      sync_status TEXT NOT NULL DEFAULT 'pending'
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
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_pending_uploads_status ON pending_image_uploads(status);
    CREATE INDEX IF NOT EXISTS idx_pending_uploads_note ON pending_image_uploads(note_doc_id);

    -- Insert Main folder if not exists
    INSERT INTO folders (id, name)
    VALUES ('${MAIN_FOLDER_ID}', 'Main')
    ON CONFLICT (id) DO NOTHING;
  `);

  return testDb;
}

/**
 * Get the current test database instance
 */
export function getTestDatabase(): PGlite {
  if (!testDb) {
    throw new Error('Test database not initialized. Call createTestDatabase() first.');
  }
  return testDb;
}

/**
 * Close and cleanup the test database
 */
export async function closeTestDatabase(): Promise<void> {
  if (testDb) {
    await testDb.close();
    testDb = null;
  }
}

/**
 * Reset all tables (useful between tests)
 */
export async function resetTestDatabase(): Promise<void> {
  if (!testDb) return;

  await testDb.exec(`
    DELETE FROM document_updates;
    DELETE FROM search_index;
    DELETE FROM job_queue;
    DELETE FROM app_state;
    DELETE FROM sync_records;
    DELETE FROM pending_image_uploads;
    DELETE FROM folders WHERE id != '${MAIN_FOLDER_ID}';
  `);
}
