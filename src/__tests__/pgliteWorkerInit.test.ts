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
  flushLog: [] as string[],
};

/** Loads pglite-worker.ts with the engine and worker runtime stubbed out. */
async function loadWorkerInit(): Promise<InitFn> {
  vi.resetModules();
  mocks.pgliteArgs = [];
  mocks.flushLog = [];
  // A local, assigned only inside the mock factory below: resetting a property
  // here instead would pin its type for the rest of this function.
  let captured: InitFn | undefined;
  vi.doMock('@electric-sql/pglite', () => ({
    PGlite: class FakePGlite {
      waitReady = Promise.resolve();
      constructor(options: Record<string, unknown>) {
        mocks.pgliteArgs.push(options);
      }
    },
    IdbFs: class FakeIdbFs {
      dataDir: string;
      constructor(dataDir: string) {
        this.dataDir = dataDir;
      }
      async syncToFs() {
        mocks.flushLog.push('start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        mocks.flushLog.push('end');
      }
    },
  }));
  // The real worker() wires up postMessage handlers; capture the callback instead.
  vi.doMock('../lib/db/pgliteWorkerHost', () => ({
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
  // The worker posts its boot timing marks to the page.
  vi.stubGlobal('postMessage', vi.fn());
  // ...and listens for the page's flush requests (#833).
  vi.stubGlobal('addEventListener', vi.fn());
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

  it('opens the same IndexedDB data dir through its filesystem and marks when Postgres is up', async () => {
    const init = await loadWorkerInit();

    await init({ dataDir: 'idb://journal-db-pg18' });
    await Promise.resolve();

    expect((mocks.pgliteArgs[0].fs as { dataDir: string }).dataDir).toBe('journal-db-pg18');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'journal-boot-mark', step: 'db-open' }));
  });

  it('runs IndexedDB flushes one at a time, and answers a flush request once its flush is done (#833)', async () => {
    const init = await loadWorkerInit();
    const onMessage = vi.mocked(addEventListener).mock.calls.find(([type]) => type === 'message')![1] as unknown as (event: { data: unknown }) => void;
    const flushed = () => new Promise((resolve) => vi.mocked(postMessage).mockImplementation((message) => {
      if ((message as { type: string }).type === 'journal-flushed') resolve(message);
    }));

    // Before Postgres is up there is nothing to flush: a flush then would overwrite the stored data dir.
    let answer = flushed();
    onMessage({ data: { type: 'journal-flush', id: 1 } });
    expect(await answer).toEqual({ type: 'journal-flushed', id: 1 });
    expect(mocks.flushLog).toEqual([]);

    await init({ dataDir: 'idb://journal-db-pg18' });
    await Promise.resolve();
    const fs = mocks.pgliteArgs[0].fs as { syncToFs(relaxed?: boolean): Promise<void> };
    answer = flushed();
    const engineFlush = fs.syncToFs(true);
    onMessage({ data: { type: 'journal-flush', id: 2 } });
    expect(await answer).toEqual({ type: 'journal-flushed', id: 2 });
    await engineFlush;
    expect(mocks.flushLog).toEqual(['start', 'end', 'start', 'end']);
  });
});
