/**
 * Backlinks live query: prove NOTE_LIST_SQL.backlinks (metadata->'linkedNoteIds' ? $1)
 * surfaces linking notes reactively through PGlite's live extension, and honours the
 * active filter — the contract the "Linked mentions" panel depends on.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';
import { NOTE_LIST_SQL, NOTE_ROW_KEY, type NoteListRow } from '@/lib/db/queries';

type LiveDB = PGlite & { live: LiveNamespace };

const TARGET = '60000000-0000-0000-0000-0000000000aa';
const SRC1 = '60000000-0000-0000-0000-000000000001';
const SRC2 = '60000000-0000-0000-0000-000000000002';
const OTHER = '60000000-0000-0000-0000-000000000003';

let db: LiveDB;

async function insertNote(
  id: string,
  title: string,
  opts: { linkedNoteIds?: string[]; archivalStatus?: number } = {}
) {
  const metadata = {
    title,
    folderId: 'main',
    archivalStatus: opts.archivalStatus ?? 0,
    timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
    ...(opts.linkedNoteIds ? { linkedNoteIds: opts.linkedNoteIds } : {}),
  };
  await db.query(
    `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
    [id, title, title, JSON.stringify(metadata)]
  );
}

async function setLinks(id: string, linkedNoteIds: string[]) {
  await db.query(
    `UPDATE search_index
     SET metadata = jsonb_set(metadata, '{linkedNoteIds}', $2::jsonb), updated_at = CURRENT_TIMESTAMP
     WHERE doc_id = $1`,
    [id, JSON.stringify(linkedNoteIds)]
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
  `);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec(`DELETE FROM search_index;`); });

describe('NOTE_LIST_SQL.backlinks — live linked-mentions', () => {
  it('returns only notes whose linkedNoteIds contains the target', async () => {
    await insertNote(SRC1, 'Links to target', { linkedNoteIds: [TARGET] });
    await insertNote(OTHER, 'Links elsewhere', { linkedNoteIds: [SRC2] });
    await insertNote(TARGET, 'The target', {});

    const lq = await db.live.incrementalQuery<NoteListRow>(NOTE_LIST_SQL.backlinks, [TARGET], NOTE_ROW_KEY);
    expect(lq.initialResults.rows.map((r) => r.title)).toEqual(['Links to target']);
    await lq.unsubscribe();
  });

  it('reacts when a link is added then removed', async () => {
    await insertNote(SRC1, 'Source', { linkedNoteIds: [] });
    let rows: NoteListRow[] = [];
    const lq = await db.live.incrementalQuery<NoteListRow>(
      NOTE_LIST_SQL.backlinks, [TARGET], NOTE_ROW_KEY, (res) => { rows = res.rows; }
    );
    expect(lq.initialResults.rows).toHaveLength(0);

    await setLinks(SRC1, [TARGET]);
    await waitFor(() => rows.length === 1);
    expect(rows[0].doc_id).toBe(SRC1);

    await setLinks(SRC1, []);
    await waitFor(() => rows.length === 0);

    await lq.unsubscribe();
  });

  it('excludes archived/trashed sources even if they link to the target', async () => {
    await insertNote(SRC1, 'Active source', { linkedNoteIds: [TARGET], archivalStatus: 0 });
    await insertNote(SRC2, 'Archived source', { linkedNoteIds: [TARGET], archivalStatus: 1 });

    const lq = await db.live.incrementalQuery<NoteListRow>(NOTE_LIST_SQL.backlinks, [TARGET], NOTE_ROW_KEY);
    expect(lq.initialResults.rows.map((r) => r.doc_id)).toEqual([SRC1]);
    await lq.unsubscribe();
  });
});
