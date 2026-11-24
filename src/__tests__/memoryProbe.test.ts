// @vitest-environment happy-dom
/** The memory probe (#1487) counts what the open notes hold on to. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { UndoManager } from 'yjs';

vi.mock('@/lib/db', () => ({
    getDocumentUpdates: vi.fn(async (docId: string) => (docId === 'a' ? [new Uint8Array(1), new Uint8Array(1)] : [new Uint8Array(1)])),
    saveDocumentUpdate: vi.fn(),
    replaceDocumentUpdates: vi.fn(),
    getSearchIndexEntry: vi.fn(),
}));

import { PGliteProvider } from '@/lib/yjs/provider';
import { liveUndoManagers } from '@/components/editor/plugins/collaboration';
import { probeMemory } from '@/lib/utils/memoryProbe';

const providers: PGliteProvider[] = [];

afterEach(async () => {
    for (const provider of providers.splice(0)) await provider.destroy();
    liveUndoManagers.clear();
    document.body.replaceChildren();
});

describe('probeMemory', () => {
    it('reports mounted tabs, live-block frames, and each open note’s undo stack and stored rows', async () => {
        const docA = new Y.Doc();
        const docB = new Y.Doc();
        providers.push(new PGliteProvider('a', docA), new PGliteProvider('b', docB));
        liveUndoManagers.add({ doc: docA, undoStack: [{}, {}, {}] } as unknown as UndoManager);
        document.body.innerHTML = `
            <div data-note-scroller><div data-live-block="html"><iframe></iframe></div></div>
            <div data-note-scroller><div data-live-block="mermaid"><iframe></iframe></div></div>
            <iframe title="not a live block"></iframe>`;

        const probe = await probeMemory();
        expect(probe.mountedTabs).toBe(2);
        expect(probe.liveBlockFrames).toBe(2);
        expect(probe.docs).toEqual([
            { docId: 'a', undoStack: 3, storedRows: 2 },
            { docId: 'b', undoStack: 0, storedRows: 1 },
        ]);
    });
});
