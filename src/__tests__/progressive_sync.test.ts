/**
 * Phase 1 progressive-sync integration: prove the real NOTE_LIST_SQL / FOLDERS_SQL
 * constants (the ones the live-query hooks subscribe to) emit progressively and
 * honour the active/archived/trashed filters when driven through PGlite's `live`
 * extension. Uses a direct in-memory PGlite with the same schema the app wires
 * through PGliteWorker.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';
import {
  NOTE_LIST_SQL,
  NOTE_ROW_KEY,
  FOLDERS_SQL,
  FOLDER_ROW_KEY,
  toNoteListEntry,
  type NoteListRow,
} from '@/lib/db/queries';

type LiveDB = PGlite & { live: LiveNamespace };

const ID1 = '30000000-0000-0000-0000-000000000001';
const ID2 = '30000000-0000-0000-0000-000000000002';
const ID3 = '30000000-0000-0000-0000-000000000003';
const FOLDER_A = '30000000-0000-0000-0000-0000000000aa';

let db: LiveDB;

/** Insert a note the way upsertSearchIndex does: metadata carries timestamps + archivalStatus. */
async function insertNote(
  id: string,
  title: string,
  opts: { folderId?: string; archivalStatus?: number; modified?: string; isPinned?: boolean } = {}
) {
  const metadata = {
    title,
    folderId: opts.folderId ?? 'main',
    archivalStatus: opts.archivalStatus ?? 0,
    isPinned: opts.isPinned ?? false,
    timestamps: { created: '2026-01-01T00:00:00.000Z', modified: opts.modified ?? '2026-01-01T00:00:00.000Z' },
  };
  await db.query(
    `INSERT INTO search_index (doc_id, title, plain_text_content, metadata)
     VALUES ($1, $2, $3, $4)`,
    [id, title, title, JSON.stringify(metadata)]
  );
}

/** Mirror setNoteArchivalStatusLocal — flip archivalStatus, preserving other metadata. */
async function setArchivalStatus(id: string, status: number) {
  await db.query(
    `UPDATE search_index
     SET metadata = jsonb_set(metadata, '{archivalStatus}', to_jsonb($2::int)),
         updated_at = CURRENT_TIMESTAMP
     WHERE doc_id = $1`,
    [id, status]
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for live emission');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  db = (await PGlite.create({ extensions: { live } })) as LiveDB;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS search_index (
      doc_id UUID PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      plain_text_content TEXT DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS folders (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec(`DELETE FROM search_index; DELETE FROM folders;`); });

describe('NOTE_LIST_SQL.active — progressive emission + active filter', () => {
  it('streams notes in cumulatively as they are inserted (the WhatsApp effect)', async () => {
    const counts: number[] = [];
    const lq = await db.live.incrementalQuery<NoteListRow>(
      NOTE_LIST_SQL.active, [], NOTE_ROW_KEY, (res) => counts.push(res.rows.length)
    );
    expect(lq.initialResults.rows).toHaveLength(0);

    await insertNote(ID1, 'Alpha', { modified: '2026-01-01T00:00:01.000Z' });
    await waitFor(() => counts.includes(1));
    await insertNote(ID2, 'Bravo', { modified: '2026-01-01T00:00:02.000Z' });
    await waitFor(() => counts.includes(2));

    expect(counts.at(-1)).toBe(2);
    await lq.unsubscribe();
  });

  it('excludes archived (1) and trashed (2) notes from the active list', async () => {
    await insertNote(ID1, 'Active', { archivalStatus: 0 });
    await insertNote(ID2, 'Archived', { archivalStatus: 1 });
    await insertNote(ID3, 'Trashed', { archivalStatus: 2 });

    const lq = await db.live.incrementalQuery<NoteListRow>(NOTE_LIST_SQL.active, [], NOTE_ROW_KEY);
    const titles = lq.initialResults.rows.map((r) => r.title);
    expect(titles).toEqual(['Active']);
    await lq.unsubscribe();
  });

  it('maps rows to NoteListEntry shape consumers expect', async () => {
    await insertNote(ID1, 'Mapped');
    const lq = await db.live.incrementalQuery<NoteListRow>(NOTE_LIST_SQL.active, [], NOTE_ROW_KEY);
    const entry = toNoteListEntry(lq.initialResults.rows[0]);
    expect(entry).toMatchObject({ docId: ID1, title: 'Mapped' });
    expect(entry.metadata.archivalStatus).toBe(0);
    await lq.unsubscribe();
  });
});

describe('trash / archive transitions move notes between live lists', () => {
  it('trashing a note removes it from active and adds it to trashed', async () => {
    await insertNote(ID1, 'ToTrash');

    let active: NoteListRow[] = [];
    let trashed: NoteListRow[] = [];
    const activeLq = await db.live.incrementalQuery<NoteListRow>(
      NOTE_LIST_SQL.active, [], NOTE_ROW_KEY, (res) => { active = res.rows; }
    );
    const trashLq = await db.live.incrementalQuery<NoteListRow>(
      NOTE_LIST_SQL.trashed, [], NOTE_ROW_KEY, (res) => { trashed = res.rows; }
    );
    expect(activeLq.initialResults.rows).toHaveLength(1);
    expect(trashLq.initialResults.rows).toHaveLength(0);

    await setArchivalStatus(ID1, 2);
    await waitFor(() => active.length === 0 && trashed.length === 1);

    expect(trashed[0].title).toBe('ToTrash');
    await activeLq.unsubscribe();
    await trashLq.unsubscribe();
  });

  it('archiving then unarchiving round-trips between active and archived', async () => {
    await insertNote(ID1, 'ToArchive');
    let active: NoteListRow[] = [];
    let archived: NoteListRow[] = [];
    const activeLq = await db.live.incrementalQuery<NoteListRow>(
      NOTE_LIST_SQL.active, [], NOTE_ROW_KEY, (res) => { active = res.rows; }
    );
    const archiveLq = await db.live.incrementalQuery<NoteListRow>(
      NOTE_LIST_SQL.archived, [], NOTE_ROW_KEY, (res) => { archived = res.rows; }
    );

    await setArchivalStatus(ID1, 1);
    await waitFor(() => active.length === 0 && archived.length === 1);

    await setArchivalStatus(ID1, 0);
    await waitFor(() => active.length === 1 && archived.length === 0);

    await activeLq.unsubscribe();
    await archiveLq.unsubscribe();
  });
});

describe('NOTE_LIST_SQL.byFolder — folder-scoped live query', () => {
  it('only emits notes for the requested folder', async () => {
    await insertNote(ID1, 'InA', { folderId: FOLDER_A });
    await insertNote(ID2, 'InMain', { folderId: 'main' });

    let rows: NoteListRow[] = [];
    const lq = await db.live.incrementalQuery<NoteListRow>(
      NOTE_LIST_SQL.byFolder, [FOLDER_A], NOTE_ROW_KEY, (res) => { rows = res.rows; }
    );
    expect(lq.initialResults.rows.map((r) => r.title)).toEqual(['InA']);

    await insertNote(ID3, 'AlsoInA', { folderId: FOLDER_A, modified: '2026-02-01T00:00:00.000Z' });
    await waitFor(() => rows.length === 2);

    await lq.unsubscribe();
  });
});

describe('FOLDERS_SQL — folder list live query', () => {
  it('emits on folder creation', async () => {
    let rows: Array<{ id: string; name: string }> = [];
    const lq = await db.live.incrementalQuery<{ id: string; name: string; created_at: Date }>(
      FOLDERS_SQL, [], FOLDER_ROW_KEY, (res) => { rows = res.rows; }
    );
    expect(lq.initialResults.rows).toHaveLength(0);

    await db.query(`INSERT INTO folders (id, name) VALUES ($1, $2)`, [FOLDER_A, 'Work']);
    await waitFor(() => rows.length === 1);
    expect(rows[0].name).toBe('Work');

    await lq.unsubscribe();
  });
});
