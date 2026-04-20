import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

worker({
  async init(options) {
    return new PGlite({
      dataDir: options.dataDir,
      loadDataDir: options.loadDataDir as Blob | undefined,
      extensions: { pg_trgm },
    });
  },
});
