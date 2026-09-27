/**
 * Validates NOTE_COUNTS_SQL — the single-row counts query that backs the sidebar
 * trash/archive/shared badges (replacing three full-list live subscriptions at
 * boot). The filters must mirror NOTE_LIST_SQL.{trashed,archived,collaborative},
 * since wrong filters mean wrong badge numbers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { NOTE_COUNTS_SQL, NOTE_LIST_SQL, type NoteCountsRow } from '@/lib/db';

const HOST = 'host.example';

function generateTestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function insertNote(db: PGlite, metadata: Record<string, unknown>): Promise<string> {
  const id = generateTestId();
  await db.query(
    `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, 'T', '', $2)`,
    [id, JSON.stringify(metadata)],
  );
  return id;
}

async function insertSyncRecord(db: PGlite, localId: string, authorOdinId: string) {
  await db.query(
    `INSERT INTO sync_records (local_id, entity_type, author_odin_id) VALUES ($1, 'note', $2)`,
    [localId, authorOdinId],
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
    const res = await db.query<NoteCountsRow>(NOTE_COUNTS_SQL, [HOST]);
    expect(res.rows[0]).toEqual({ trashed: 0, archived: 0, collaborative: 0 });
  });

  it('counts trashed / archived / collaborative and ignores active notes', async () => {
    await insertNote(db, { folderId: 'main' }); // active — not counted
    await insertNote(db, { folderId: 'main', archivalStatus: 2 }); // trashed
    await insertNote(db, { folderId: 'main', archivalStatus: 2 }); // trashed
    await insertNote(db, { folderId: 'main', archivalStatus: 1 }); // archived
    // shared with me (active)
    await insertNote(db, { folderId: 'main', isCollaborative: true, authorOdinId: 'peer.example' });
    // shared with me but trashed → counts as trashed, NOT as collaborative
    await insertNote(db, { folderId: 'main', isCollaborative: true, authorOdinId: 'peer.example', archivalStatus: 2 });

    const res = await db.query<NoteCountsRow>(NOTE_COUNTS_SQL, [HOST]);
    expect(res.rows[0]).toEqual({ trashed: 3, archived: 1, collaborative: 1 });
  });

  it('counts and lists only notes shared by another identity', async () => {
    await insertNote(db, { folderId: 'main', archivalStatus: 2 }); // trashed
    await insertNote(db, { folderId: 'main', archivalStatus: 1 }); // archived
    // A: peer author in metadata
    const a = await insertNote(db, { folderId: 'main', isCollaborative: true, authorOdinId: 'peer.example' });
    // B: author only in sync_records
    const b = await insertNote(db, { folderId: 'main', isCollaborative: true });
    await insertSyncRecord(db, b, 'peer2.example');
    // C: no author anywhere — shared by you
    await insertNote(db, { folderId: 'main', isCollaborative: true });
    // D: sync_records author is the host itself
    const d = await insertNote(db, { folderId: 'main', isCollaborative: true });
    await insertSyncRecord(db, d, HOST);

    const counts = await db.query<NoteCountsRow>(NOTE_COUNTS_SQL, [HOST]);
    expect(counts.rows[0]).toEqual({ trashed: 1, archived: 1, collaborative: 2 });

    const list = await db.query<{ doc_id: string }>(NOTE_LIST_SQL.collaborative, [HOST]);
    expect(list.rows.map((r) => r.doc_id).sort()).toEqual([a, b].sort());
  });
});
