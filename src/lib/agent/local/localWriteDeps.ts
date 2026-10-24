/**
 * `WriteDeps` over the app's local PGlite database, for the in-app agent's `append_to_note`
 * and `create_note` (#702). A write is saved the way the app saves an edit: a Yjs update, the
 * search index, a pending sync record, and a broadcast so other tabs' editors reload. The
 * Homebase-only fields (`versionTag`, `fileId`) mean nothing here, so they are empty, and no
 * write raises `VersionConflictError`. Everything the agent may not do here throws.
 */
import * as Y from 'yjs';
import type { WriteDeps } from '@/lib/agent/tools/write';
import { createLocalDeps, loadLocalNote } from '@/lib/agent/local/localDeps';
import { documentBroadcast } from '@/lib/broadcast/DocumentBroadcast';
import { getSyncRecord, saveDocumentUpdate, updateSyncStatus, upsertSearchIndex, upsertSyncRecord } from '@/lib/db';
import { captureSnapshot } from '@/lib/history/snapshot';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';

/** Shown as the editor of a note the assistant wrote ("Journal Assistant"). */
const CLIENT_NAME = 'journal-assistant';

const unavailable = (what: string) => async (): Promise<never> => {
    throw new Error(`${what} isn't available here.`);
};

export function createLocalWriteDeps(): WriteDeps {
    return {
        ...createLocalDeps(),

        async fetchNoteForEdit(id) {
            const note = await loadLocalNote(id);
            // No versionTag or fileId: those are Homebase's, and a local write never conflicts.
            return note && { summary: note.summary, doc: note.doc, versionTag: '', fileId: '', metadata: note.metadata };
        },

        async uploadNoteEdit(id, edit) {
            // The version history keeps the note as it was before this edit.
            const before = await loadLocalYDoc(id);
            if (before) await captureSnapshot(id, before, { throttle: false });

            const next = new Y.Doc();
            Y.applyUpdate(next, edit.yjsBlob);
            await saveDocumentUpdate(id, Y.encodeStateAsUpdate(next, before ? Y.encodeStateVector(before) : undefined));

            const metadata = { ...edit.metadata, timestamps: { ...edit.metadata.timestamps, modified: new Date().toISOString() } };
            await upsertSearchIndex({
                docId: id,
                title: metadata.title,
                plainTextContent: await extractPreviewTextFromYjs(id),
                metadata,
            });
            if (await getSyncRecord(id)) await updateSyncStatus(id, 'pending');
            else await upsertSyncRecord({ localId: id, entityType: 'note', syncStatus: 'pending' });
            documentBroadcast.notifyDocumentUpdated(id);
        },

        async createNote(uniqueId, metadata, yjsBlob) {
            await saveDocumentUpdate(uniqueId, yjsBlob);
            await upsertSearchIndex({
                docId: uniqueId,
                title: metadata.title,
                plainTextContent: await extractPreviewTextFromYjs(uniqueId, yjsBlob),
                metadata,
            });
            await upsertSyncRecord({ localId: uniqueId, entityType: 'note', syncStatus: 'pending' });
        },

        createFolder: unavailable('Creating folders'),
        uploadNoteImage: unavailable('Images'),
        trashNote: unavailable('Deleting notes'),
        grantFolder: unavailable('Granting access'),
        loadImage: async () => {
            throw new Error("Images can't be added here");
        },
        clientName: () => CLIENT_NAME,
    };
}
