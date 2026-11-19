/**
 * The desktop app's encrypted database (#1361) end to end: the worker's filesystem
 * (workerFs.ts) under the real engine and the real pglite-cipher, with the store in
 * memory instead of IndexedDB (which Node doesn't have).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { importKek, MemoryBackend, WrongKeyError } from 'pglite-cipher';
import { PGLITE_START_PARAMS } from '@/lib/db/startParams';
import { createWorkerFs } from '@/lib/db/workerFs';

const store = vi.hoisted(() => ({ backends: [] as unknown[], names: [] as string[] }));

/** The backend, but a close keeps it, so a restart can open the same records. */
const surviveClose = <T extends object>(backend: T): T =>
  new Proxy(backend, {
    get(target, property) {
      if (property === 'close') return async () => {};
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

vi.mock('pglite-cipher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pglite-cipher')>();
  return {
    ...actual,
    IndexedDbBackend: {
      pair: (name: string) => {
        store.names.push(name);
        return (store.backends as object[]).map(surviveClose);
      },
    },
  };
});

const MARKER = 'marker-1361-only-in-plaintext';

const newKey = () => importKek(crypto.getRandomValues(new Uint8Array(32)));

async function open(key: CryptoKey) {
  const { fs, flush } = await createWorkerFs(undefined, key);
  const pg = await PGlite.create({ fs, relaxedDurability: true, startParams: PGLITE_START_PARAMS });
  return { pg, flush };
}

/** Every stored record, to search for plaintext. */
async function storedBytes(): Promise<string> {
  const chunks: string[] = [];
  for (const backend of store.backends as MemoryBackend[]) {
    for (const [, value] of await backend.readRange(null, Number.MAX_SAFE_INTEGER)) chunks.push(Buffer.from(value).toString('latin1'));
    for (const slot of [0, 1, 2] as const) {
      const value = await backend.get(slot);
      if (value) chunks.push(Buffer.from(value).toString('latin1'));
    }
  }
  return chunks.join('');
}

beforeEach(() => {
  store.backends = [new MemoryBackend(), new MemoryBackend()];
  store.names = [];
  // The filesystem posts boot timing marks to the page.
  vi.stubGlobal('postMessage', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encrypted database (#1361)', () => {
  it('keeps notes across a restart with the same key, and stores no plaintext', async () => {
    const key = await newKey();

    const first = await open(key);
    await first.pg.exec(`CREATE TABLE notes (body text); INSERT INTO notes VALUES ('${MARKER}');`);
    await first.flush();
    await first.pg.close();

    expect(store.names).toEqual(['journal-data']);
    const stored = await storedBytes();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored).not.toContain(MARKER);

    const again = await open(key);
    const { rows } = await again.pg.query<{ body: string }>('SELECT body FROM notes');
    expect(rows).toEqual([{ body: MARKER }]);
    await again.pg.close();
  }, 60_000);

  it('refuses another key', async () => {
    const first = await open(await newKey());
    await first.pg.close();

    await expect(open(await newKey())).rejects.toBeInstanceOf(WrongKeyError);
  }, 60_000);
});
