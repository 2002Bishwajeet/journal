/**
 * Real-engine round trip for the legacy (Postgres 17) → PGlite 0.5 (Postgres 18)
 * migration: pg_dump from the legacy engine with the app's args, restored into
 * the current engine the way initDatabase does it (one transaction, then RESET
 * search_path). Guards future bumps of pglite / pglite-tools / the legacy
 * aliases against silently breaking the upgrade path.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGlite as PGliteV3 } from 'pglite-v3';
import { PGlite as PGliteV4 } from 'pglite-v4';
import { pg_trgm as pg_trgm_v4 } from 'pglite-v4/contrib/pg_trgm';
import { pgDump } from '@electric-sql/pglite-tools/pg_dump';
import { PG_DUMP_ARGS, openLegacyDatabase, dumpLegacyDataDir } from '../lib/db/pglite-migrate';
import { restoreLegacyDump } from '../lib/db/pglite';

const DOC_ID = '00000000-0000-0000-0000-000000000001';

const LEGACY_SEED = `
  CREATE TABLE schema_meta (id INTEGER PRIMARY KEY, version TEXT NOT NULL);
  INSERT INTO schema_meta VALUES (1, '3');
  CREATE TABLE document_updates (id SERIAL PRIMARY KEY, doc_id UUID NOT NULL, update_blob BYTEA NOT NULL);
  CREATE TABLE search_index (
    doc_id UUID PRIMARY KEY, title TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}',
    vector_embedding REAL[], search_vector tsvector
  );
  CREATE TABLE folders (id UUID PRIMARY KEY, name TEXT NOT NULL);
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX idx_search_title_trgm ON search_index USING GIN(title gin_trgm_ops);
  INSERT INTO folders VALUES ('00000000-0000-0000-0000-0000000000f1', 'Legacy folder');
  INSERT INTO document_updates (doc_id, update_blob) VALUES ('${DOC_ID}', '\\xdeadbeef00'), ('${DOC_ID}', '\\x01');
  INSERT INTO search_index VALUES (
    '${DOC_ID}', 'héllo ''quoted'' 🎉', '{"folderId":"f1","tags":["a"]}', '{1.5,2.25}',
    to_tsvector('english', 'hello world')
  );
`;

type Dumpable = Parameters<typeof pgDump>[0]['pg'];

async function dumpSql(db: unknown): Promise<string> {
  const file = await pgDump({ pg: db as Dumpable, args: PG_DUMP_ARGS });
  return file.text();
}

async function restore(target: PGlite, sql: string) {
  await target.transaction((tx) => tx.exec(sql));
  await target.exec('RESET search_path;');
}

async function newTarget(): Promise<PGlite> {
  return PGlite.create({ extensions: { pg_trgm } });
}

async function expectLegacyData(db: PGlite) {
  // Unqualified names: proves RESET search_path undid pg_dump's session-wide ''.
  const docs = await db.query<{ doc_id: string; hex: string }>(
    `SELECT doc_id, encode(update_blob, 'hex') AS hex FROM document_updates ORDER BY id`,
  );
  expect(docs.rows.map((r) => r.hex)).toEqual(['deadbeef00', '01']);

  const search = await db.query<{
    title: string;
    metadata: { folderId: string; tags: string[] };
    vector_embedding: number[];
    search_vector: string;
  }>(`SELECT title, metadata, vector_embedding, search_vector FROM search_index`);
  expect(search.rows).toEqual([
    {
      title: "héllo 'quoted' 🎉",
      metadata: { folderId: 'f1', tags: ['a'] },
      vector_embedding: [1.5, 2.25],
      search_vector: "'hello':1 'world':2",
    },
  ]);

  // The trigram index (and so the pg_trgm extension) came across and works.
  const trgm = await db.query(`SELECT title FROM search_index WHERE title % 'héllo quoted'`);
  expect(trgm.rows).toHaveLength(1);
  const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_search_title_trgm'`);
  expect(idx.rows).toHaveLength(1);

  // SERIAL sequence position survived: a new row doesn't collide with legacy ids.
  const inserted = await db.query<{ id: number }>(
    `INSERT INTO document_updates (doc_id, update_blob) VALUES ('${DOC_ID}', '\\x02') RETURNING id`,
  );
  expect(inserted.rows[0].id).toBeGreaterThan(2);

  const meta = await db.query<{ version: string }>(`SELECT version FROM schema_meta`);
  expect(meta.rows).toEqual([{ version: '3' }]);
}

describe('legacy PGlite dump → PGlite 0.5 restore', () => {
  it('round-trips a v0.4 database into the current engine', async () => {
    const legacy = await PGliteV4.create({ extensions: { pg_trgm: pg_trgm_v4 } });
    await legacy.exec(LEGACY_SEED);
    const sql = await dumpSql(legacy);
    await legacy.close();

    const target = await newTarget();
    await restore(target, sql);
    await expectLegacyData(target);
    await target.close();
  });

  it('restores over an already-initialized target, replacing its copies of the tables', async () => {
    const legacy = await PGliteV4.create({ extensions: { pg_trgm: pg_trgm_v4 } });
    await legacy.exec(LEGACY_SEED);
    const sql = await dumpSql(legacy);
    await legacy.close();

    // A previous launch whose restore failed booted fresh on the new dir and ran
    // initializeSchema: same table names, a seeded row, plus a table the legacy
    // DB doesn't have.
    const target = await newTarget();
    await target.exec(`
      CREATE TABLE schema_meta (id INTEGER PRIMARY KEY, version TEXT NOT NULL);
      INSERT INTO schema_meta VALUES (1, '3');
      CREATE TABLE document_updates (id SERIAL PRIMARY KEY, doc_id UUID NOT NULL, update_blob BYTEA NOT NULL);
      CREATE TABLE search_index (doc_id UUID PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled');
      CREATE TABLE folders (id UUID PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO folders VALUES ('06cf9262-4eae-4276-b0d1-8ca3cf5be6f4', 'Main');
      CREATE TABLE sync_errors (id SERIAL PRIMARY KEY, error_message TEXT NOT NULL);
      INSERT INTO sync_errors (error_message) VALUES ('from the fresh session');
    `);

    await restore(target, sql);
    await expectLegacyData(target);
    const folders = await target.query<{ name: string }>(`SELECT name FROM folders`);
    expect(folders.rows).toEqual([{ name: 'Legacy folder' }]);
    const kept = await target.query(`SELECT 1 FROM sync_errors`);
    expect(kept.rows).toHaveLength(1);
    await target.close();
  });

  it('restores through the app\'s own restore path, and never replays it twice', async () => {
    // Exercises the real SQL initDatabase runs: pg_dump clears search_path for
    // the session, so the marker write after it must stay schema-qualified.
    const legacy = await PGliteV4.create({ extensions: { pg_trgm: pg_trgm_v4 } });
    await legacy.exec(LEGACY_SEED);
    const sql = await dumpSql(legacy);
    await legacy.close();

    const target = await newTarget();
    expect(await restoreLegacyDump(target, sql)).toBe(true);
    // Leaves a row of its own behind (the sequence check), so a second restore
    // would be visible as data loss.
    await expectLegacyData(target);

    expect(await restoreLegacyDump(target, sql)).toBe(false);
    const rows = await target.query<{ c: number }>(`SELECT count(*)::int AS c FROM document_updates`);
    expect(rows.rows[0].c).toBe(3);
    await target.close();
  });

  it('dumps template1 when a 0.4 dir left v0.3-era data stranded there', async () => {
    // What the shipped physical 0.3→0.4 migration produced: user tables still in
    // template1, `postgres` (the database 0.4 connects to) empty.
    const dir = mkdtempSync(join(tmpdir(), 'journal-template1-'));
    try {
      const legacy = await PGliteV4.create(dir, {
        database: 'template1',
        extensions: { pg_trgm: pg_trgm_v4 },
      });
      await legacy.exec(LEGACY_SEED);
      await legacy.close();

      const sql = await dumpLegacyDataDir('0.4', dir);
      if (!sql) throw new Error('expected the stranded template1 data to be dumped');

      const target = await newTarget();
      await restore(target, sql);
      await expectLegacyData(target);
      await target.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the current engine for a Postgres 18 dir stamped 0.4', async () => {
    // Fresh installs made while PGlite 0.5 ran against the legacy dir left a
    // Postgres 18 data dir there. The v0.4 engine refuses it for real here.
    const dir = mkdtempSync(join(tmpdir(), 'journal-pg18-'));
    try {
      const pg18 = await PGlite.create(dir, { extensions: { pg_trgm } });
      await pg18.exec(LEGACY_SEED);
      await pg18.close();

      const legacy = await openLegacyDatabase('0.4', dir);
      const sql = await dumpSql(legacy);
      await legacy.close();

      const target = await newTarget();
      await restore(target, sql);
      await expectLegacyData(target);
      await target.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips a v0.3 database via an in-memory v0.4 engine on template1', async () => {
    // Mirrors dumpLegacyDatabase(null): pg_dump can't drive v0.3 directly.
    const v3 = await PGliteV3.create();
    await v3.exec(`CREATE TABLE folders (id UUID PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO folders VALUES ('00000000-0000-0000-0000-0000000000f1', 'From v0.3');`);
    const dataDir = await v3.dumpDataDir('none');
    await v3.close();
    const legacy = await PGliteV4.create({ loadDataDir: dataDir, database: 'template1' });
    const sql = await dumpSql(legacy);
    await legacy.close();

    const target = await newTarget();
    await restore(target, sql);
    const folders = await target.query<{ name: string }>(`SELECT name FROM folders`);
    expect(folders.rows).toEqual([{ name: 'From v0.3' }]);
    await target.close();
  });
});
