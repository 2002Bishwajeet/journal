import * as Y from 'yjs';
import { getDocumentUpdates } from '@/lib/db';

/** Build a Y.Doc by applying the given updates in order. */
export function ydocFromUpdates(updates: Uint8Array[]): Y.Doc {
    const ydoc = new Y.Doc();
    for (const update of updates) {
        Y.applyUpdate(ydoc, update);
    }
    return ydoc;
}

/** Load a note's Y.Doc from its locally stored updates; null when it has none. */
export async function loadLocalYDoc(docId: string): Promise<Y.Doc | null> {
    const updates = await getDocumentUpdates(docId);
    if (updates.length === 0) return null;
    return ydocFromUpdates(updates);
}
