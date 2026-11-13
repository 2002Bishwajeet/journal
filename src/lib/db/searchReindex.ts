import { suspendLiveQueries } from '@/hooks/useLiveQuery';
import { getDatabase } from '@/lib/db/pglite';
import { reclaimSpace } from './queries/maintenance';

export const REINDEX_BATCH_SIZE = 200;

/**
 * Rebuilds the search vector of up to `limit` notes written before
 * journal_search_vector (vector_version 1, #1229) and returns how many it rebuilt.
 * Only search_vector and vector_version change: not updated_at, metadata or sync status.
 */
export async function reindexSearchBatch(limit = REINDEX_BATCH_SIZE): Promise<number> {
    const db = await getDatabase();
    const result = await db.query(
        `UPDATE search_index
         SET search_vector = journal_search_vector(title, plain_text_content, metadata->'tags'), vector_version = 2
         WHERE doc_id IN (SELECT doc_id FROM search_index WHERE vector_version < 2 LIMIT $1)`,
        [limit],
    );
    return result.affectedRows ?? 0;
}

const yieldToApp = () =>
    new Promise<void>((resolve) =>
        typeof requestIdleCallback === 'function'
            ? requestIdleCallback(() => resolve(), { timeout: 1000 })
            : setTimeout(resolve, 0),
    );

/**
 * Rebuilds every old search vector in batches, yielding to the app between them, then
 * reclaims the dead rows the rewrite leaves. Each batch commits on its own, so a run cut
 * short (tab closed, crash) continues where it stopped on the next launch. The note lists'
 * live queries are paused meanwhile, as during a bulk sync pull, so they do not re-run
 * after every batch.
 */
export async function runSearchReindex(): Promise<void> {
    const db = await getDatabase();
    const old = await db.query('SELECT 1 FROM search_index WHERE vector_version < 2 LIMIT 1');
    if (old.rows.length === 0) return;
    const resume = suspendLiveQueries();
    try {
        while ((await reindexSearchBatch()) > 0) await yieldToApp();
    } finally {
        resume();
    }
    await reclaimSpace(['search_index']);
}
