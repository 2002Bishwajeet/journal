import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { ySyncPluginKey, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { getSnapshotBlob } from '@/lib/db';
import { captureSnapshot } from './snapshot';

/**
 * Replace the editor's content with a saved snapshot.
 *
 * Goes through the editor rather than a raw Y transaction: only a ProseMirror
 * transaction becomes a ySyncPluginKey Yjs transaction, which the UndoManager
 * tracks (Cmd+Z) and the provider persists and sync pushes. Re-applying the old
 * Yjs update couldn't roll anything back — a CRDT only moves forward.
 */
export async function restoreSnapshot(editor: Editor, docId: string, snapshotId: number): Promise<void> {
    const blob = await getSnapshotBlob(snapshotId);
    if (!blob) throw new Error(`Snapshot ${snapshotId} not found`);

    // Safety net: the state being replaced stays restorable (skipped only when
    // it is identical to the newest snapshot).
    const doc: Y.Doc = ySyncPluginKey.getState(editor.state).doc;
    await captureSnapshot(docId, doc, { throttle: false });

    const snapDoc = new Y.Doc();
    Y.applyUpdate(snapDoc, blob);
    const json = yXmlFragmentToProsemirrorJSON(snapDoc.getXmlFragment('prosemirror'));
    snapDoc.destroy();

    editor.commands.setContent(json, { emitUpdate: true });
}
