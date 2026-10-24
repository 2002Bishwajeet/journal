/**
 * initializeSchema must be read-only when the schema is already current: a write
 * on the idb:// VFS costs a full IndexedDB flush (~500ms) on every launch.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initializeSchema, SCHEMA_VERSION } from '@/lib/db/schema';

const WRITE = /^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/i;

/** Record every statement the schema code sends to the database. */
function spy(db: PGlite) {
  const statements: string[] = [];
  const exec = db.exec.bind(db);
  const query = db.query.bind(db);
  db.exec = ((sql: string) => (statements.push(sql), exec(sql))) as typeof db.exec;
  db.query = ((sql: string, ...rest: unknown[]) =>
    (statements.push(sql), (query as (...a: unknown[]) => unknown)(sql, ...rest))) as typeof db.query;
  return statements;
}

describe('initializeSchema read-only boot', () => {
  let db: PGlite;
  afterEach(async () => {
    await db.close();
  });

  it('runs no write statement when the schema is current', async () => {
    db = new PGlite();
    await initializeSchema(db);

    const statements = spy(db);
    await initializeSchema(db);

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((s) => WRITE.test(s))).toEqual([]);
  });

  it('creates and stamps a fresh database', async () => {
    db = new PGlite();
    await initializeSchema(db);

    const meta = await db.query<{ version: string }>('SELECT version FROM schema_meta WHERE id = 1');
    expect(meta.rows[0].version).toBe(SCHEMA_VERSION);
    const tables = await db.query<{ present: boolean }>(
      `SELECT to_regclass('search_index') IS NOT NULL AS present`,
    );
    expect(tables.rows[0].present).toBe(true);
  });

  it('re-runs setup when the stored version is old', async () => {
    db = new PGlite();
    await initializeSchema(db);
    await db.exec(`UPDATE schema_meta SET version = '0' WHERE id = 1`);
    await db.exec(`DROP TABLE job_queue`);

    await initializeSchema(db);

    const meta = await db.query<{ version: string }>('SELECT version FROM schema_meta WHERE id = 1');
    expect(meta.rows[0].version).toBe(SCHEMA_VERSION);
    const t = await db.query<{ present: boolean }>(`SELECT to_regclass('job_queue') IS NOT NULL AS present`);
    expect(t.rows[0].present).toBe(true);
  });

  it('drops vector_embedding from a version-6 database and keeps its rows', async () => {
    db = new PGlite();
    await initializeSchema(db);
    await db.exec(`
      ALTER TABLE search_index ADD COLUMN vector_embedding REAL[];
      INSERT INTO search_index (doc_id, title, plain_text_content, metadata, search_vector, vector_embedding)
      VALUES ('00000000-0000-0000-0000-000000000001', 'Kept', 'body', '{"a":1}', to_tsvector('english', 'hello world'), '{1.5}');
      UPDATE schema_meta SET version = '6' WHERE id = 1;
    `);

    await initializeSchema(db);

    const cols = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'search_index' AND column_name = 'vector_embedding'`,
    );
    expect(cols.rows).toHaveLength(0);
    const rows = await db.query(`SELECT title, plain_text_content, metadata, search_vector::text AS sv FROM search_index`);
    expect(rows.rows).toEqual([
      { title: 'Kept', plain_text_content: 'body', metadata: { a: 1 }, sv: "'hello':1 'world':2" },
    ]);
  });

  it('a fresh database has no vector_embedding column', async () => {
    db = new PGlite();
    await initializeSchema(db);
    const cols = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'search_index' AND column_name = 'vector_embedding'`,
    );
    expect(cols.rows).toHaveLength(0);
  });
});
