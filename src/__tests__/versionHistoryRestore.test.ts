// @vitest-environment happy-dom
/**
 * Restoring a version goes through the editor (setContent), so it is one
 * ySyncPlugin transaction: undoable with Cmd+Z and persisted/synced like any
 * other edit. Real extensions + real PGlite, as in undoRedo.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { getSnapshots } from '@/lib/db';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension, undo } from '@/components/editor/plugins/collaboration';
import { captureSnapshot } from '@/lib/history/snapshot';
import { restoreSnapshot } from '@/lib/history/restore';

const DOC_ID = '30000000-0000-0000-0000-000000000001';

// The UndoManager merges edits within 500 ms into one step; pause between
// steps the way a real user does (open the modal, confirm).
const pause = () => new Promise((r) => setTimeout(r, 600));

let ydoc: Y.Doc;
let editor: Editor;

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    ydoc = new Y.Doc();
    editor = new Editor({
        element: document.createElement('div'),
        extensions: [...createBaseExtensions(), createCollaborationExtension(ydoc.getXmlFragment('prosemirror'))],
    });
});
afterEach(() => {
    editor.destroy();
    ydoc.destroy();
});

/** Snapshot the current doc and return the new snapshot's id. */
async function snapshotNow(): Promise<number> {
    await captureSnapshot(DOC_ID, ydoc, { throttle: false });
    return (await getSnapshots(DOC_ID))[0].id;
}

function replaceText(text: string) {
    editor.commands.setContent(`<p>${text}</p>`);
}

describe('restoreSnapshot', () => {
    it('restores the snapshot content into the editor', async () => {
        replaceText('Version A');
        const snapA = await snapshotNow();
        await pause();
        replaceText('Version B');
        await pause();

        await restoreSnapshot(editor, DOC_ID, snapA);

        expect(editor.getText()).toBe('Version A');
    });

    it('keeps the Yjs doc consistent: a further edit round-trips through a fresh doc', async () => {
        replaceText('Version A');
        const snapA = await snapshotNow();
        await pause();
        replaceText('Version B');
        await pause();
        await restoreSnapshot(editor, DOC_ID, snapA);

        editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' then C');

        const fresh = new Y.Doc();
        Y.applyUpdate(fresh, Y.encodeStateAsUpdate(ydoc));
        const freshEditor = new Editor({
            element: document.createElement('div'),
            extensions: [...createBaseExtensions(), createCollaborationExtension(fresh.getXmlFragment('prosemirror'))],
        });
        expect(editor.getText()).toBe('Version A then C');
        expect(freshEditor.getText()).toBe(editor.getText());
        freshEditor.destroy();
        fresh.destroy();
    });

    it('is a single undo step: undo after restore brings back the pre-restore text', async () => {
        replaceText('Version A');
        const snapA = await snapshotNow();
        await pause();
        replaceText('Version B');
        await pause();
        await restoreSnapshot(editor, DOC_ID, snapA);

        expect(undo(editor.state)).toBe(true);

        expect(editor.getText()).toBe('Version B');
    });

    it('saves a safety snapshot of the current state before restoring', async () => {
        replaceText('Version A');
        const snapA = await snapshotNow();
        await pause();
        replaceText('Version B');

        await restoreSnapshot(editor, DOC_ID, snapA);

        const previews = (await getSnapshots(DOC_ID)).map((s) => s.preview);
        expect(previews).toEqual(['Version B', 'Version A']);
    });

    it('restoring the same version twice leaves exactly one copy of the content', async () => {
        replaceText('Version A');
        const snapA = await snapshotNow();
        await pause();
        replaceText('Version B');
        await pause();

        await restoreSnapshot(editor, DOC_ID, snapA);
        await pause();
        await restoreSnapshot(editor, DOC_ID, snapA);

        expect(editor.getText()).toBe('Version A');
        expect(ydoc.getXmlFragment('prosemirror').length).toBe(1);
    });
});
