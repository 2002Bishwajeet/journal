/**
 * Phase 0 spike for progressive sync: prove PGlite's `live` extension emits
 * progressively as rows are written. Uses a direct in-memory PGlite with the
 * live extension (the app wires the same extension through PGliteWorker).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';

// Mock the app DB module so acquireLiveQuery (below) resolves to a PGlite we
// control per-test — the real one (a settable var) for parking, a fake capturing
// one for coalescing. The existing tests above use `db` directly and are
// unaffected (they never import from @/lib/db/pglite).
vi.mock('@/lib/db/pglite', () => {
  let mockDb: unknown = null;
  return {
    getLiveDatabase: async () => mockDb,
    getDatabase: async () => mockDb,
    __setMockDb: (d: unknown) => { mockDb = d; },
  };
});
import * as pgliteModule from '@/lib/db/pglite';
import { acquireLiveQuery } from '@/hooks/useLiveQuery';

const setMockDb = (d: unknown) =>
  (pgliteModule as unknown as { __setMockDb: (d: unknown) => void }).__setMockDb(d);

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

type Row = { doc_id: string; title: string; metadata: unknown };
const titlesOf = (rows: unknown[]) => (rows as Row[]).map((r) => r.title);

describe('acquireLiveQuery — parking (no-flash folder switch, no idle subscription)', () => {
  beforeEach(() => setMockDb(db));

  it('serves parked rows instantly on reacquire, holds no live subscription while parked, then refreshes', async () => {
    await insertNote(ID1, 'Alpha');

    const key = 'park::' + LIST_SQL;
    const calls1: unknown[][] = [];
    const h1 = acquireLiveQuery(key, LIST_SQL, [], (rows) => calls1.push(rows));

    // First consumer: subscription lands with the initial row set.
    await waitFor(() => calls1.length > 0);
    expect(titlesOf(calls1.at(-1)!)).toEqual(['Alpha']);

    // Last consumer leaves → entry parks (its PGlite subscription is torn down).
    h1.release();

    // Write while parked. A still-live subscription would fold this in; a parked
    // one must not — its rows stay frozen at the last emission.
    await insertNote(ID2, 'Bravo');
    await new Promise((r) => setTimeout(r, 120));

    // Reacquire: cached OLD rows served synchronously with ready:true (no loading
    // flash). That they are OLD (1 row, not the current 2) proves the parked
    // entry held no live subscription across the write.
    const calls2: unknown[][] = [];
    const h2 = acquireLiveQuery(key, LIST_SQL, [], (rows) => calls2.push(rows));
    expect(h2.ready).toBe(true);
    expect(titlesOf(h2.rows)).toEqual(['Alpha']);

    // Then the fresh subscription lands with the CURRENT rows — two emissions
    // (instant cached snapshot, then live refresh), never a loading state.
    await waitFor(() => calls2.length > 0 && titlesOf(calls2.at(-1)!).length === 2);
    expect(titlesOf(calls2.at(-1)!)).toEqual(['Alpha', 'Bravo']);

    h2.release();
  });
});

describe('acquireLiveQuery — coalescing burst emissions', () => {
  it('collapses a burst of 5 emissions into <= 2 listener calls, last write wins', async () => {
    // Fake DB captures the live-query callback so we can drive emissions directly
    // and deterministically, independent of PGlite write latency.
    let capturedCb: ((res: { rows: unknown[] }) => void) | null = null;
    const fakeDb = {
      live: {
        query: async (
          _sql: string,
          _params: unknown[],
          cb: (res: { rows: unknown[] }) => void,
        ) => {
          capturedCb = cb;
          return { initialResults: { rows: [] as unknown[] }, unsubscribe: async () => {} };
        },
      },
    };
    setMockDb(fakeDb);

    const key = 'coalesce::burst';
    const calls: unknown[][] = [];
    const h = acquireLiveQuery(key, 'SELECT 1', [], (rows) => calls.push(rows));

    // Wait for the subscription to be established (and its initial [] emission).
    await waitFor(() => capturedCb !== null);
    const cb = capturedCb!;
    calls.length = 0; // ignore the initial ready emission; measure only the burst

    cb({ rows: [{ n: 1 }] });
    cb({ rows: [{ n: 2 }] });
    cb({ rows: [{ n: 3 }] });
    cb({ rows: [{ n: 4 }] });
    cb({ rows: [{ n: 5 }] });

    // Let the trailing-debounce window (150ms) flush.
    await new Promise((r) => setTimeout(r, 250));

    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.at(-1)).toEqual([{ n: 5 }]); // the latest rows always land

    h.release();
  });
});
