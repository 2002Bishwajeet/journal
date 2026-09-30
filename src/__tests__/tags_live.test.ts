/**
 * Tags live query: prove TAGS_SQL surfaces tag changes reactively through PGlite's
 * live extension — the contract the sidebar tag list (useTags) depends on.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { live, type LiveNamespace } from '@electric-sql/pglite/live';
import { TAGS_SQL } from '@/lib/db/queries';

type LiveDB = PGlite & { live: LiveNamespace };

const NOTE = '70000000-0000-0000-0000-000000000001';

let db: LiveDB;

async function insertNote(id: string, tags: string[]) {
  const metadata = {
    title: 'Tagged',
    folderId: 'main',
    tags,
    timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
  };
  await db.query(
    `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES ($1, $2, $3, $4)`,
    [id, 'Tagged', 'Tagged', JSON.stringify(metadata)]
  );
}

async function setTags(id: string, tags: string[]) {
  await db.query(
    `UPDATE search_index
     SET metadata = jsonb_set(metadata, '{tags}', $2::jsonb), updated_at = CURRENT_TIMESTAMP
     WHERE doc_id = $1`,
    [id, JSON.stringify(tags)]
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

describe('TAGS_SQL — live tag list', () => {
  it('emits sorted tags when a tagged note is inserted, and drops a removed tag', async () => {
    let tags: string[] = [];
    const lq = await db.live.query<{ tag: string }>(TAGS_SQL, [], (res) => {
      tags = res.rows.map((r) => r.tag);
    });
    expect(lq.initialResults.rows).toHaveLength(0);

    await insertNote(NOTE, ['b', 'a']);
    await waitFor(() => tags.length === 2);
    expect(tags).toEqual(['a', 'b']);

    await setTags(NOTE, ['a']);
    await waitFor(() => tags.length === 1);
    expect(tags).toEqual(['a']);

    await lq.unsubscribe();
  });
});
