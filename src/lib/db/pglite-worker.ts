import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { live } from '@electric-sql/pglite/live';

worker({
  async init(options) {
    return new PGlite({
      dataDir: options.dataDir,
      // Without this every query waits for a full IndexedDB flush (~16 MB
      // rewritten per write). The trade-off is that COMMIT returns before the
      // flush, so the migrating launch passes false — see createWorkerInstance.
      // PGliteWorker posts every option except `extensions` to the worker
      // verbatim, but this init picks fields explicitly: a flag only reaches
      // the engine if it is named here.
      relaxedDurability: options.relaxedDurability !== false,
      extensions: { pg_trgm, live },
    });
  },
});
