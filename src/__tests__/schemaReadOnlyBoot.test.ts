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
});
