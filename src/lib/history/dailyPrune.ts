import { claimDailyJob, deleteSnapshots, finishJob, getSnapshotDocIds, getSnapshots, reclaimSpace } from '@/lib/db/queries';
import { selectSnapshotsToPrune } from './retention';

/**
 * The daily pass (#1054): captureSnapshot prunes only the note it saves, so this prunes
 * every note's snapshots as of `now`, and notes never edited again lose old history too.
 * Then it reclaims the space. Claimed through job_queue, so it runs at most once a day
 * across tabs.
 */
export async function runDailySnapshotPrune(now = new Date()): Promise<void> {
    const jobId = await claimDailyJob('snapshot-prune', now);
    if (jobId === null) return;
    try {
        let totalBytes = 0;
        let prunedBytes = 0;
        // One note at a time, so the app's own queries interleave with the pass
        for (const docId of await getSnapshotDocIds()) {
            const snaps = await getSnapshots(docId);
            const prune = new Set(selectSnapshotsToPrune(snaps, now));
            await deleteSnapshots([...prune]);
            for (const snap of snaps) {
                totalBytes += snap.bytes;
                if (prune.has(snap.id)) prunedBytes += snap.bytes;
            }
        }
        // New snapshots reuse what a plain VACUUM frees, but only a rewrite shrinks the
        // table. That is worth its cost when a quarter of the history went, as on the
        // first pass over history kept before #1054 (about 500 MB to 260 MB at 10,000 notes).
        if (prunedBytes > 0) await reclaimSpace(['document_snapshots'], { full: prunedBytes * 4 >= totalBytes });
        await finishJob(jobId);
    } catch (error) {
        await finishJob(jobId, error);
        throw error;
    }
}
