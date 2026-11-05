import { IdbFs, PGlite } from '@electric-sql/pglite';
// Our copy of the leader loop, fixing a lock leak when a tab closes (see the file).
import { worker } from './pgliteWorkerHost';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { live } from '@electric-sql/pglite/live';

/**
 * A boot timing mark from inside the worker (#901), posted to the page, which records it
 * as `journal-boot:<step>` (see createWorkerInstance). The time is absolute, as the
 * worker's clock starts later than the page's.
 */
function markBoot(step: string) {
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

  // Flushes run one at a time, so a 'journal-flush' (below) never overlaps the engine's own.
  syncToFs(relaxedDurability?: boolean) {
    const flush = this.#flushing.then(() => super.syncToFs(relaxedDurability));
    this.#flushing = flush.catch(() => {});
    return flush;
  }
}

// Set once this tab's worker is the leader and Postgres is up on the loaded data dir:
// a flush before the load would write an empty data dir over the stored one.
let openFs: TimedIdbFs | undefined;

// e2e's syncToDisk (flushToIndexedDb in pglite.ts): under relaxedDurability the engine's
// flushes are not awaited by anyone, so this flushes now and answers once IndexedDB has it.
// A follower tab's worker has no data dir and answers at once.
addEventListener('message', (event: MessageEvent<{ type?: string; id?: number }>) => {
  if (event.data?.type !== 'journal-flush') return;
  const { id } = event.data;
  void (openFs?.syncToFs() ?? Promise.resolve()).finally(() => postMessage({ type: 'journal-flushed', id }));
});

worker({
  async init(options) {
    const fs = new TimedIdbFs(options.dataDir!.replace(/^idb:\/\//, ''));
    const pg = new PGlite({
      dataDir: options.dataDir,
      // The same filesystem the engine picks for an idb:// dataDir, with the timing marks.
      fs,
      // Without this every query waits for a full IndexedDB flush (~16 MB
      // rewritten per write). The trade-off is that COMMIT returns before the
      // flush, so the migrating launch passes false — see createWorkerInstance.
      // PGliteWorker posts every option except `extensions` to the worker
      // verbatim, but this init picks fields explicitly: a flag only reaches
      // the engine if it is named here.
      relaxedDurability: options.relaxedDurability !== false,
      extensions: { pg_trgm, live },
    });
    // Postgres is running on the loaded data dir.
    void pg.waitReady.then(() => {
      openFs = fs;
      markBoot('db-open');
    });
    return pg;
  },
});
