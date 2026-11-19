import { IdbFs, type MemoryFS } from '@electric-sql/pglite';
import { ENCRYPTED_STORE } from './databaseKey';

/**
 * A boot timing mark from inside the worker (#901), posted to the page, which records it
 * as `journal-boot:<step>` (see createWorkerInstance). The time is absolute, as the
 * worker's clock starts later than the page's.
 */
export function markBoot(step: string) {
  postMessage({ type: 'journal-boot-mark', step, at: performance.timeOrigin + performance.now() });
}

/** The engine's IndexedDB filesystem, timing its read of the data dir at startup. */
class TimedIdbFs extends IdbFs {
  #flushing: Promise<unknown> = Promise.resolve();

  async initialSyncFs() {
    markBoot('db-idb-read');
    await super.initialSyncFs();
    markBoot('db-idb-loaded');
  }

  // Flushes run one at a time, so a 'journal-flush' (pglite-worker.ts) never overlaps the engine's own.
  syncToFs(relaxedDurability?: boolean) {
    const flush = this.#flushing.then(() => super.syncToFs(relaxedDurability));
    this.#flushing = flush.catch(() => {});
    return flush;
  }
}

export interface WorkerFs {
  fs: IdbFs | MemoryFS;
  /** Writes everything committed to IndexedDB, and resolves once it has it. */
  flush(): Promise<unknown>;
}

/**
 * The worker's filesystem: with a key (the desktop app) pglite-cipher's EncryptedFs, else
 * the plain `idb://` data dir. pglite-cipher is imported only on the encrypted path, so the
 * PWA never loads it.
 */
export async function createWorkerFs(dataDir: string | undefined, key: CryptoKey | undefined): Promise<WorkerFs> {
  if (!key) {
    const fs = new TimedIdbFs(dataDir!.replace(/^idb:\/\//, ''));
    return { fs, flush: () => fs.syncToFs() };
  }
  const { EncryptedFs, IndexedDbBackend } = await import('pglite-cipher');
  class TimedEncryptedFs extends EncryptedFs {
    async initialSyncFs() {
      markBoot('db-idb-read');
      await super.initialSyncFs();
      markBoot('db-idb-loaded');
    }
  }
  const fs = new TimedEncryptedFs({
    backend: IndexedDbBackend.pair(ENCRYPTED_STORE),
    key,
    mode: 'open-or-create',
    // Reading the blocks is the slow part of a large store's open (#1365): tell the page how far it is.
    onProgress: ({ phase, done, total }) => {
      if (phase === 'blocks') postMessage({ type: 'journal-open-progress', done, total });
    },
  });
  // Strict: the engine's own syncs under relaxedDurability are relaxed ones.
  return { fs, flush: () => fs.syncToFs(false) };
}
