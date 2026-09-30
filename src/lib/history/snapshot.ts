import * as Y from 'yjs';
import { saveSnapshot, getSnapshots, getLatestSnapshotVector, deleteSnapshots } from '@/lib/db';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import { selectSnapshotsToPrune } from './retention';

const THROTTLE_MS = 5 * 60_000;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Save the doc's full state as a version-history snapshot, then prune old ones.
 * Skipped when nothing changed since the newest snapshot (same state vector) or,
 * with `throttle`, when the newest is under 5 minutes old.
 */
export async function captureSnapshot(
    docId: string,
    doc: Y.Doc,
    { throttle }: { throttle: boolean },
): Promise<void> {
    const stateVector = Y.encodeStateVector(doc);
    const latest = await getLatestSnapshotVector(docId);
    if (latest) {
        if (throttle && Date.now() - latest.createdAt.getTime() < THROTTLE_MS) return;
        if (sameBytes(latest.stateVector, stateVector)) return;
    }

    const stateBlob = Y.encodeStateAsUpdate(doc);
    const text = await extractPreviewTextFromYjs(docId, stateBlob);
    await saveSnapshot(docId, {
        stateBlob,
        stateVector,
        preview: text.slice(0, 200),
        wordCount: text.split(/\s+/).filter(Boolean).length,
    });

    const prune = selectSnapshotsToPrune(await getSnapshots(docId), new Date());
    await deleteSnapshots(prune);
}
