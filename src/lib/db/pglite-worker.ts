import { PGlite } from '@electric-sql/pglite';
// Our copy of the leader loop, fixing a lock leak when a tab closes (see the file).
import { worker } from './pgliteWorkerHost';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { live } from '@electric-sql/pglite/live';
import { PGLITE_START_PARAMS } from './startParams';
import { createWorkerFs, markBoot } from './workerFs';

// Set once this tab's worker is the leader and Postgres is up on the loaded data dir:
// a flush before the load would write an empty data dir over the stored one.
let flushFs: (() => Promise<unknown>) | undefined;

// e2e's syncToDisk (flushToIndexedDb in pglite.ts): under relaxedDurability the engine's
// flushes are not awaited by anyone, so this flushes now and answers once IndexedDB has it.
// A follower tab's worker has no data dir and answers at once.
addEventListener('message', (event: MessageEvent<{ type?: string; id?: number }>) => {
  if (event.data?.type !== 'journal-flush') return;
  const { id } = event.data;
  void (flushFs?.() ?? Promise.resolve()).finally(() => postMessage({ type: 'journal-flushed', id }));
});

worker({
  async init(options) {
    // The desktop app's key (#1361), imported by the page from the OS keychain.
    const { key } = options as { key?: CryptoKey };
    const { fs, flush } = await createWorkerFs(options.dataDir, key);
    const pg = new PGlite({
      dataDir: options.dataDir,
      // The same filesystem the engine picks for an idb:// dataDir, with the timing marks;
      // or the encrypted one, which has no dataDir.
      fs,
      // Without this every query waits for a full IndexedDB flush (~16 MB
      // rewritten per write). The trade-off is that COMMIT returns before the
      // flush, so the migrating launch passes false — see createWorkerInstance.
      // PGliteWorker posts every option except `extensions` to the worker
      // verbatim, but this init picks fields explicitly: a flag only reaches
      // the engine if it is named here.
      relaxedDurability: options.relaxedDurability !== false,
      startParams: PGLITE_START_PARAMS,
      extensions: { pg_trgm, unaccent, live },
    });
    // Postgres is running on the loaded data dir.
    void pg.waitReady.then(
      () => {
        flushFs = flush;
        markBoot('db-open');
      },
      // Queries wait for a ready engine, so the page would wait forever: tell it why
      // (a damaged encrypted store is a CorruptStoreError, #1362).
      (error: Error) => postMessage({ type: 'journal-open-error', name: error.name, message: error.message }),
    );
    return pg;
  },
});
