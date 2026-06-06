/**
 * Phase 0 spike for progressive sync: prove PGlite's `live` extension emits
 * progressively as rows are written. Uses a direct in-memory PGlite with the
 * live extension (the app wires the same extension through PGliteWorker).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';

type LiveDB = PGlite & { live: LiveNamespace };

const ID1 = '20000000-0000-0000-0000-000000000001';
const ID2 = '20000000-0000-0000-0000-000000000002';
const ID3 = '20000000-0000-0000-0000-000000000003';

const LIST_SQL =
  `SELECT doc_id, title, metadata FROM search_index ORDER BY title ASC`;

let db: LiveDB;

async function insertNote(id: string, title: string, folderId = 'main') {
  await db.query(
    `INSERT INTO search_index (doc_id, title, plain_text_content, metadata)
     VALUES ($1, $2, $3, $4)`,
    [id, title, title, JSON.stringify({ title, folderId })]
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

describe('PGlite live.incrementalQuery — progressive-sync foundation', () => {
  it('returns the initial result set on subscribe', async () => {
    await insertNote(ID1, 'Alpha');
    const lq = await db.live.incrementalQuery(LIST_SQL, [], 'doc_id');
    expect(lq.initialResults.rows).toHaveLength(1);
    await lq.unsubscribe();
  });

  it('emits progressively as rows are inserted one-by-one (the WhatsApp effect)', async () => {
    const counts: number[] = [];
    const lq = await db.live.incrementalQuery(LIST_SQL, [], 'doc_id', (res) =>
      counts.push(res.rows.length)
    );
    expect(lq.initialResults.rows).toHaveLength(0);

    await insertNote(ID1, 'Alpha');
    await waitFor(() => counts.includes(1));
    await insertNote(ID2, 'Bravo');
    await waitFor(() => counts.includes(2));
    await insertNote(ID3, 'Charlie');
    await waitFor(() => counts.includes(3));

    expect(counts.at(-1)).toBe(3); // cumulative state, not a diff
    await lq.unsubscribe();
  });

  it('emits on update and on delete', async () => {
    await insertNote(ID1, 'Alpha');
    let last: Array<{ title: string }> = [];
    const lq = await db.live.incrementalQuery<{ doc_id: string; title: string }>(
      LIST_SQL,
      [],
      'doc_id',
      (res) => { last = res.rows; }
    );

    await db.query(`UPDATE search_index SET title = $2 WHERE doc_id = $1`, [ID1, 'Renamed']);
    await waitFor(() => last.some((r) => r.title === 'Renamed'));

    await db.query(`DELETE FROM search_index WHERE doc_id = $1`, [ID1]);
    await waitFor(() => last.length === 0);

    await lq.unsubscribe();
  });

  it('preserves JSONB metadata and supports a folderId WHERE filter', async () => {
    await insertNote(ID1, 'InMain', 'main');
    await insertNote(ID2, 'InWork', 'work');

    const counts: number[] = [];
    const lq = await db.live.incrementalQuery<{ doc_id: string; metadata: { folderId: string } }>(
      `SELECT doc_id, title, metadata FROM search_index WHERE metadata->>'folderId' = $1 ORDER BY title ASC`,
      ['main'],
      'doc_id',
      (res) => counts.push(res.rows.length)
    );
    expect(lq.initialResults.rows).toHaveLength(1);
    expect((lq.initialResults.rows[0].metadata as { folderId: string }).folderId).toBe('main');

    await insertNote(ID3, 'AnotherMain', 'main');
    await waitFor(() => counts.includes(2));

    await lq.unsubscribe();
  });

  it('stops emitting after unsubscribe', async () => {
    const counts: number[] = [];
    const lq = await db.live.incrementalQuery(LIST_SQL, [], 'doc_id', (res) =>
      counts.push(res.rows.length)
    );
    await insertNote(ID1, 'Alpha');
    await waitFor(() => counts.length > 0);
    const seen = counts.length;

    await lq.unsubscribe();
    await insertNote(ID2, 'Bravo');
    await new Promise((r) => setTimeout(r, 150));

    expect(counts.length).toBe(seen); // no further emissions after unsubscribe
  });
});
