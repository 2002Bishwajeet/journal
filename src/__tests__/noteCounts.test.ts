/**
 * Validates NOTE_COUNTS_SQL — the single-row counts query that backs the sidebar
 * trash/archive/shared badges (replacing three full-list live subscriptions at
 * boot). The filters must mirror NOTE_LIST_SQL.{trashed,archived,collaborative},
 * since wrong filters mean wrong badge numbers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { NOTE_COUNTS_SQL, type NoteCountsRow } from '@/lib/db';

function generateTestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function insertNote(db: PGlite, metadata: Record<string, unknown>) {
  await db.query(
    `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, 'T', '', $2)`,
    [generateTestId(), JSON.stringify(metadata)],
  );
}

describe('NOTE_COUNTS_SQL', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await closeTestDatabase();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('returns zeros on an empty table', async () => {
    const res = await db.query<NoteCountsRow>(NOTE_COUNTS_SQL);
    expect(res.rows[0]).toEqual({ trashed: 0, archived: 0, collaborative: 0 });
  });

  it('counts trashed / archived / collaborative and ignores active notes', async () => {
    await insertNote(db, { folderId: 'main' }); // active — not counted
    await insertNote(db, { folderId: 'main', archivalStatus: 2 }); // trashed
    await insertNote(db, { folderId: 'main', archivalStatus: 2 }); // trashed
    await insertNote(db, { folderId: 'main', archivalStatus: 1 }); // archived
    await insertNote(db, { folderId: 'main', isCollaborative: true }); // collaborative (active)
    // collaborative but trashed → counts as trashed, NOT as collaborative
    await insertNote(db, { folderId: 'main', isCollaborative: true, archivalStatus: 2 });

    const res = await db.query<NoteCountsRow>(NOTE_COUNTS_SQL);
    expect(res.rows[0]).toEqual({ trashed: 3, archived: 1, collaborative: 1 });
  });
});
