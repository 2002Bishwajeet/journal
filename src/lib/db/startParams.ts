import { PGlite } from '@electric-sql/pglite';

/**
 * Postgres flags for the app's PGlite (#1054). PGlite runs Postgres in single-user mode, where nothing
 * checkpoints on its own (max_wal_size never triggers one), so WAL grows until an explicit CHECKPOINT.
 * With wal_recycle on, that checkpoint then keeps the old segments as spares, up to about max_wal_size
 * (1 GB). Off, it deletes them. The app checkpoints after the daily snapshot prune, imports and
 * large deletes (see reclaimSpace in queries/maintenance.ts).
 */
export const PGLITE_START_PARAMS = [...PGlite.defaultStartParams, '-c', 'wal_recycle=off'];
