import * as Y from 'yjs';
import { getAppState, getSearchIndexEntry, saveAppState } from '@/lib/db';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { createNoteWithContentInDb } from '@/lib/notes/createNote';
import { splitCapture } from '@/lib/quickCapture';
import { pushContentBlocks } from '@/lib/yjs/noteContent';
import { openTodayNote } from '@/hooks/useDailyNote';
import { licenseAllowsActions, type BridgeAction, type BridgeLicense } from './bridge';

/** app_state key: the ids already imported, so an action saved but never acked imports once. */
export const BRIDGE_SEEN_KEY = 'bridge-seen-actions';
const SEEN_LIMIT = 200;

export interface BridgeImportResult {
    /** Ids the native queue may delete: each one is saved (or was seen before). */
    ack: string[];
    /** The note the last `open` (or blank `new_note`) asks for. */
    open: { docId: string; folderId: string } | null;
}

async function appendToToday(text: string): Promise<void> {
    const { docId } = await openTodayNote();
    // The local write path the in-app assistant uses: history snapshot, index, sync, broadcast.
    const { createLocalWriteDeps } = await import('@/lib/agent/local/localWriteDeps');
    const deps = createLocalWriteDeps();
    const note = await deps.fetchNoteForEdit(docId);
    if (!note) throw new Error(`Today's note is missing: ${docId}`);
    pushContentBlocks(note.doc.getXmlFragment('prosemirror'), text);
    await deps.uploadNoteEdit(docId, {
        fileId: note.fileId,
        versionTag: note.versionTag,
        metadata: note.metadata,
        yjsBlob: Y.encodeStateAsUpdate(note.doc),
    });
}

/**
 * Imports the actions the native surfaces queued, oldest first. Every action is rejected
 * (left queued, not acked) unless the licence is a trial or licensed; the native side checks
 * too. An action that fails stays queued for the next drain.
 */
export async function importBridgeActions(actions: BridgeAction[], license: BridgeLicense): Promise<BridgeImportResult> {
    const result: BridgeImportResult = { ack: [], open: null };
    if (!licenseAllowsActions(license) || actions.length === 0) return result;

    const seen = (await getAppState<string[]>(BRIDGE_SEEN_KEY)) ?? [];
    const sorted = [...actions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const action of sorted) {
        if (seen.includes(action.id)) {
            result.ack.push(action.id);
            continue;
        }
        try {
            const text = action.text?.trim() ?? '';
            if (action.type === 'new_note') {
                // First line = title, the rest = body, as the share target and quick capture do.
                const note = splitCapture(text) ?? { title: '', content: '' };
                const created = await createNoteWithContentInDb({ ...note, folderId: MAIN_FOLDER_ID });
                if (!text) result.open = created;
            } else if (action.type === 'append_today') {
                if (text) await appendToToday(text);
            } else if (action.type === 'open' && action.noteId) {
                // A malformed id (not a uuid) is a missing note too, not a reason to retry forever.
                const entry = await getSearchIndexEntry(action.noteId).catch(() => null);
                if (entry) result.open = { docId: action.noteId, folderId: entry.metadata.folderId };
            }
            seen.push(action.id);
            await saveAppState(BRIDGE_SEEN_KEY, seen.slice(-SEEN_LIMIT));
            result.ack.push(action.id);
        } catch (err) {
            console.error(`[bridge] Failed to import action ${action.id}:`, err);
        }
    }
    return result;
}
