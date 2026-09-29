/**
 * #153: a bulk sync pull suspends the always-on live queries so PGlite doesn't
 * re-run every subscribed query after each pulled note, then re-subscribes once.
 * Runs the real list/counts/folders/title-map SQL through acquireLiveQuery against
 * an in-memory PGlite with the `live` extension, counting query emissions.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';
import {
  NOTE_LIST_SQL,
  NOTE_COUNTS_SQL,
  FOLDERS_SQL,
  NOTE_TITLE_MAP_SQL,
  NOTE_ROW_KEY,
  FOLDER_ROW_KEY,
  type NoteCountsRow,
} from '@/lib/db/queries';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { acquireLiveQuery, suspendLiveQueries, getLiveQueryStats } from '@/hooks/useLiveQuery';

type LiveDB = PGlite & { live: LiveNamespace };

const HOST = 'sam.dotyou.cloud';
let db: LiveDB;
let seq = 0;

/** Insert one active note; every 4th is a collaborative note shared by someone else. */
async function insertNote(folderId = 'main') {
  seq += 1;
  const id = `70000000-0000-0000-0000-${String(seq).padStart(12, '0')}`;
  const collab = seq % 4 === 0;
  const metadata = {
    title: `Note ${seq}`,
    folderId,
    archivalStatus: 0,
    timestamps: { created: '2026-01-01T00:00:00.000Z', modified: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() },
    ...(collab ? { isCollaborative: true, authorOdinId: 'frodo.dotyou.cloud' } : {}),
  };
  await db.query(
    `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
    [id, metadata.title, metadata.title, JSON.stringify(metadata)],
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 10000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for live emission');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until no live-query emission has landed for `quietMs`. */
async function waitForQuiet(quietMs = 400) {
  let last = getLiveQueryStats().emissions;
  let stableSince = Date.now();
  while (Date.now() - stableSince < quietMs) {
    await sleep(25);
    const now = getLiveQueryStats().emissions;
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
  }
}

/** Acquire a live query and track the rows its listener last received. */
function track<T>(rowKey: string, sql: string, params: unknown[] = []) {
  const state = { rows: [] as T[], calls: 0 };
  const { release } = acquireLiveQuery(`${rowKey}::${sql}::${JSON.stringify(params)}`, sql, params, (rows) => {
    state.rows = rows as T[];
    state.calls += 1;
  });
  return { state, release };
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
    CREATE TABLE IF NOT EXISTS sync_records (
      local_id UUID PRIMARY KEY,
      entity_type TEXT NOT NULL,
      author_odin_id TEXT
    );
  `);
  setTestDb(db);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`DELETE FROM search_index; DELETE FROM folders;`);
  seq = 0;
});

describe('suspendLiveQueries — bulk pull skips per-write re-execution', () => {
  it('refreshes the always-on queries once on resume instead of after every write', async () => {
    const list = track<{ doc_id: string }>(NOTE_ROW_KEY, NOTE_LIST_SQL.active);
    const counts = track<NoteCountsRow>(NOTE_ROW_KEY, NOTE_COUNTS_SQL, [HOST]);
    const folders = track<{ id: string }>(FOLDER_ROW_KEY, FOLDERS_SQL);
    const titles = track<{ doc_id: string }>(NOTE_ROW_KEY, NOTE_TITLE_MAP_SQL);
    const all = [list, counts, folders, titles];
    await waitFor(() => all.every((q) => q.state.calls > 0));
    await waitForQuiet();

    // Baseline: fully live, 100 single-row writes.
    const baseStart = getLiveQueryStats().emissions;
    for (let i = 0; i < 100; i++) await insertNote();
    await waitFor(() => list.state.rows.length === 100);
    await waitForQuiet();
    const baseline = getLiveQueryStats().emissions - baseStart;

    // Suspended: the same 100 writes, then one resume.
    const suspStart = getLiveQueryStats().emissions;
    const resume = suspendLiveQueries();
    for (let i = 0; i < 100; i++) await insertNote();
    resume();
    await waitFor(() => list.state.rows.length === 200);
    await waitForQuiet();
    const suspended = getLiveQueryStats().emissions - suspStart;

    console.log(`[liveQuerySuspend] emissions for 100 writes — baseline: ${baseline}, suspended: ${suspended}`);

    expect(suspended).toBeLessThanOrEqual(8);
    expect(suspended).toBeLessThan(baseline);
    expect(list.state.rows).toHaveLength(200);
    expect(titles.state.rows).toHaveLength(200);
    const expectedCounts = (await db.query<NoteCountsRow>(NOTE_COUNTS_SQL, [HOST])).rows[0];
    expect(expectedCounts.collaborative).toBe(50);
    expect(counts.state.rows[0]).toEqual(expectedCounts);

    // Resubscribing must not leak the torn-down subscriptions: one more write
    // re-runs at most one query per live subscription.
    const leakStart = getLiveQueryStats().emissions;
    await insertNote();
    await waitFor(() => list.state.rows.length === 201);
    await waitForQuiet();
    expect(getLiveQueryStats().emissions - leakStart).toBeLessThanOrEqual(all.length);

    all.forEach((q) => q.release());
  });

  it('stays suspended until every nested suspend has resumed', async () => {
    const list = track<{ doc_id: string }>(NOTE_ROW_KEY, NOTE_LIST_SQL.active);
    await waitFor(() => list.state.calls > 0);
    await waitFor(() => list.state.rows.length === 0);
    await waitForQuiet();

    const resumeOuter = suspendLiveQueries();
    const resumeInner = suspendLiveQueries();
    await insertNote();
    resumeInner();
    resumeInner(); // idempotent — must not release the outer suspend
    await sleep(400);
    expect(list.state.rows).toHaveLength(0);

    resumeOuter();
    await waitFor(() => list.state.rows.length === 1);

    list.release();
  });

  it('a query acquired while suspended gets its rows after resume', async () => {
    const FOLDER = '70000000-0000-0000-0000-0000000000ff';
    const resume = suspendLiveQueries();
    const byFolder = track<{ doc_id: string }>(NOTE_ROW_KEY, NOTE_LIST_SQL.byFolder, [FOLDER]);
    await insertNote(FOLDER);
    await sleep(400);
    expect(byFolder.state.calls).toBe(0);

    resume();
    await waitFor(() => byFolder.state.rows.length === 1);

    byFolder.release();
  });
});
