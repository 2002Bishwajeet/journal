import { getDatabase } from '../pglite';

/**
 * Claims today's run of a daily job in job_queue: returns its id, or null when a run was
 * claimed in the 24 hours before `now` (by this tab or another). Older runs' rows go.
 */
export async function claimDailyJob(jobType: string, now: Date): Promise<number | null> {
    const db = await getDatabase();
    const result = await db.query<{ id: number }>(
        `WITH recent AS (
             SELECT 1 FROM job_queue WHERE job_type = $1 AND created_at > $2::timestamptz - interval '1 day'
         ), old AS (
             DELETE FROM job_queue WHERE job_type = $1 AND NOT EXISTS (SELECT 1 FROM recent)
         )
         INSERT INTO job_queue (job_type, payload, created_at)
         SELECT $1, '{}', $2 WHERE NOT EXISTS (SELECT 1 FROM recent)
         RETURNING id`,
        [jobType, now],
    );
    return result.rows[0]?.id ?? null;
}

export async function finishJob(id: number, error?: unknown): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE job_queue SET status = $2, error_message = $3, processed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, error ? 'error' : 'done', error ? String(error) : null],
    );
}

/** Writes dirty pages out; with wal_recycle off (startParams.ts) this also deletes the WAL no longer needed. */
export async function checkpoint(): Promise<void> {
    const db = await getDatabase();
    await db.exec('CHECKPOINT');
}

/**
 * After a large delete: VACUUM makes the deleted rows' space reusable and gives back the
 * empty pages at the end of each table (every table, given none), then a checkpoint
 * drops the WAL. With `full`, VACUUM FULL rewrites the tables so the files shrink too,
 * which costs a copy of them and blocks every other query meanwhile.
 */
export async function reclaimSpace(tables: string[] = [], { full = false } = {}): Promise<void> {
    const db = await getDatabase();
    await db.exec(`VACUUM ${full ? 'FULL ' : ''}${tables.join(', ')}`);
    await checkpoint();
}
