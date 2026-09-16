/**
 * The worker's init() is the only place an option can be dropped on its way to
 * the engine: PGliteWorker posts every option except `extensions` to the worker
 * verbatim, but init() picks the fields it passes to `new PGlite({...})` by
 * hand. These tests pin that the durability flag actually arrives there — a
 * silent drop would leave the migrating launch running relaxed, where a COMMIT
 * returns before the write reaches IndexedDB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type InitOptions = { dataDir?: string; relaxedDurability?: boolean };

type InitFn = (options: InitOptions) => Promise<unknown>;

const mocks = {
  pgliteArgs: [] as Array<Record<string, unknown>>,
};

/** Loads pglite-worker.ts with the engine and worker runtime stubbed out. */
async function loadWorkerInit(): Promise<InitFn> {
  vi.resetModules();
  mocks.pgliteArgs = [];
  // A local, assigned only inside the mock factory below: resetting a property
  // here instead would pin its type for the rest of this function.
  let captured: InitFn | undefined;
  vi.doMock('@electric-sql/pglite', () => ({
    PGlite: class FakePGlite {
      constructor(options: Record<string, unknown>) {
        mocks.pgliteArgs.push(options);
      }
    },
  }));
  // The real worker() wires up postMessage handlers; capture the callback instead.
  vi.doMock('@electric-sql/pglite/worker', () => ({
    worker: ({ init }: { init: InitFn }) => {
      captured = init;
    },
  }));
  vi.doMock('@electric-sql/pglite/contrib/pg_trgm', () => ({ pg_trgm: { name: 'pg_trgm' } }));
  vi.doMock('@electric-sql/pglite/live', () => ({ live: { name: 'live' } }));
  await import('../lib/db/pglite-worker');
  if (!captured) throw new Error('pglite-worker did not register an init callback');
  return captured;
}

beforeEach(() => {
  mocks.pgliteArgs = [];
});

describe('pglite worker init', () => {
  it('passes relaxed durability to the engine by default', async () => {
    const init = await loadWorkerInit();

    await init({ dataDir: 'idb://journal-db-pg18' });

    expect(mocks.pgliteArgs[0].dataDir).toBe('idb://journal-db-pg18');
    expect(mocks.pgliteArgs[0].relaxedDurability).toBe(true);
  });

  it('honours a durable launch instead of silently dropping the flag', async () => {
    const init = await loadWorkerInit();

    await init({ dataDir: 'idb://journal-db-pg18', relaxedDurability: false });

    expect(mocks.pgliteArgs[0].relaxedDurability).toBe(false);
  });
});
