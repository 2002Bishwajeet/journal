/**
 * Test database setup utilities
 * Creates an in-memory PGlite database for testing
 */
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { initializeSchema, TRIGRAM_SEARCH_SQL } from '@/lib/db/schema';

let testDb: PGlite | null = null;

/**
 * Create a fresh in-memory database with the app's real schema. Trigram search
 * is enabled up front (the app does it lazily on first search).
 */
export async function createTestDatabase(): Promise<PGlite> {
  testDb = new PGlite({ extensions: { pg_trgm } });
  await initializeSchema(testDb);
  await testDb.exec(TRIGRAM_SEARCH_SQL);
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
    DELETE FROM pending_image_deletions;
    DELETE FROM sync_errors;
    DELETE FROM document_snapshots;
    DELETE FROM folders WHERE id != '${MAIN_FOLDER_ID}';
  `);
}
