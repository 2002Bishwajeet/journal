import { describe, it, expect, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('PGlite Promise Singleton Pattern', () => {
  let dbPromise: Promise<PGlite> | null = null;
  let initCount = 0;

  async function initDatabase(): Promise<PGlite> {
    initCount++;
    const db = new PGlite();
    await db.waitReady;
    await db.exec(`
      CREATE TABLE IF NOT EXISTS test_table (
        id SERIAL PRIMARY KEY,
        value TEXT
      );
    `);
    return db;
  }

  function getDatabase(): Promise<PGlite> {
    if (!dbPromise) {
      dbPromise = initDatabase().catch((err) => {
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  }

  afterAll(async () => {
    if (dbPromise) {
      const db = await dbPromise;
      await db.close();
      dbPromise = null;
    }
  });

  it('should return the same promise for concurrent calls', async () => {
    initCount = 0;
    const [db1, db2, db3] = await Promise.all([
      getDatabase(),
      getDatabase(),
      getDatabase(),
    ]);
    expect(db1).toBe(db2);
    expect(db2).toBe(db3);
    expect(initCount).toBe(1);
  });

  it('should have schema ready for all concurrent callers', async () => {
    const [db1, db2] = await Promise.all([
      getDatabase(),
      getDatabase(),
    ]);

    const r1 = await db1.query('INSERT INTO test_table (value) VALUES ($1) RETURNING id', ['from-caller-1']);
    const r2 = await db2.query('INSERT INTO test_table (value) VALUES ($1) RETURNING id', ['from-caller-2']);

    expect(r1.rows.length).toBe(1);
    expect(r2.rows.length).toBe(1);
  });
});
