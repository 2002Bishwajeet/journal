/**
 * What the open notes hold on to (#1487): `window.memoryMonitor.probe()` in a dev build, or
 * with the Homebase debug flag set (memoryMonitor.ts). Loaded on demand.
 */
import { PGliteProvider } from '@/lib/yjs/provider';
import { liveUndoManagers } from '@/components/editor/plugins/collaboration';
import { getDocumentUpdates } from '@/lib/db';

export interface MemoryProbe {
    /** Notes with a mounted editor: the active tab and the hidden ones kept mounted. */
    mountedTabs: number;
    /** Live-block frames in the page, each a page with its own scripts. */
    liveBlockFrames: number;
    docs: { docId: string; undoStack: number; storedRows: number }[];
}

export async function probeMemory(): Promise<MemoryProbe> {
    const undoManagers = [...liveUndoManagers];
    const docs = await Promise.all(
        PGliteProvider.openDocuments().map(async ({ docId, doc }) => ({
            docId,
            undoStack: undoManagers.find((manager) => manager.doc === doc)?.undoStack.length ?? 0,
            storedRows: (await getDocumentUpdates(docId)).length,
        })),
    );
    return {
        mountedTabs: document.querySelectorAll('[data-note-scroller]').length,
        liveBlockFrames: document.querySelectorAll('[data-live-block] iframe').length,
        docs,
    };
}

export async function logMemoryProbe(): Promise<MemoryProbe> {
    const probe = await probeMemory();
    console.info(`[MemoryProbe] ${probe.mountedTabs} mounted tabs, ${probe.liveBlockFrames} live-block frames`);
    console.table(probe.docs);
    return probe;
}
