import type { HomebaseFile } from '@homebase-id/js-lib/core';
import {
    upsertSearchIndex,
    deleteSearchIndexEntry,
    getDocumentUpdates,
    saveDocumentUpdate,
    deleteDocumentUpdates,
    replaceDocumentUpdates,
    getSyncRecord,
    upsertSyncRecord,
    deleteSyncRecord,
} from '@/lib/db';
import { computeContentHash } from '@/lib/utils/hash';
import { serializeKeyHeader } from '@/lib/utils';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import { COLLABORATIVE_FOLDER_ID } from '../config';
import { httpStatus } from '../httpStatus';
import type { CollaborationInviteContent } from '@/types';
import { stringGuidsEqual } from '@homebase-id/js-lib/helpers';
import { documentBroadcast } from '@/lib/broadcast';
import type { SyncContext } from './context';
import { mergeYjsDocuments } from './merge';
import type { DeletedFileRef } from './pull';

export type EnsureNoteContentStatus =
    | 'local' | 'fetched' | 'offline' | 'forbidden' | 'notfound' | 'empty' | 'error';

export interface EnsureNoteContentResult {
    status: EnsureNoteContentStatus;
}

/** Map a peer-fetch error to a typed status. No HTTP response → offline. */
export function classifyPeerFetchError(err: unknown): Extract<
    EnsureNoteContentStatus, 'forbidden' | 'notfound' | 'offline' | 'error'
> {
    const status = httpStatus(err);
    if (status === 403) return 'forbidden';
    if (status === 404) return 'notfound';
    if (status === undefined) return 'offline';
    return 'error';
}

// A fresh empty Yjs doc encodes to 2 bytes ([0, 0]). A note bootstrapped before
// the author's body had synced is a single such update, so any larger total has
// real content. (revalidatePeerNote covers the rarer "accumulated-then-emptied"
// case, so a cheap byte-sum is enough here — no need to build a Y.Doc.)
const EMPTY_YDOC_BYTES = 2;

function totalUpdateBytes(updates: Uint8Array[]): number {
    let total = 0;
    for (const update of updates) total += update.byteLength;
    return total;
}

/**
 * Local-first content load for a peer note. Returns immediately if local
 * content exists; otherwise fetches the note over peer, stores it, and
 * broadcasts so an open editor reloads.
 */
export async function ensurePeerNoteContent(
    ctx: SyncContext,
    docId: string,
    authorOdinId: string | undefined,
): Promise<EnsureNoteContentResult> {
    if (!authorOdinId || authorOdinId === ctx.hostIdentity) {
        return { status: 'local' };
    }
    const localUpdates = await getDocumentUpdates(docId);
    // Treat an empty local doc (e.g. a note bootstrapped before the author's
    // body had synced) as a miss, so we re-fetch the real content.
    if (localUpdates.length > 0 && totalUpdateBytes(localUpdates) > EMPTY_YDOC_BYTES) {
        return { status: 'local' };
    }
    return fetchAndStorePeerNote(ctx, docId, authorOdinId);
}

async function fetchAndStorePeerNote(
    ctx: SyncContext,
    docId: string,
    authorOdinId: string,
): Promise<EnsureNoteContentResult> {
    let peerNote;
    try {
        peerNote = await ctx.notesProvider.getNote(docId, authorOdinId, { decrypt: true });
    } catch (err) {
        return { status: classifyPeerFetchError(err) };
    }
    if (!peerNote || !peerNote.fileId) {
        return { status: 'notfound' };
    }

    let blob: Uint8Array | null;
    try {
        blob = await ctx.notesProvider.getNotePayload(
            peerNote.fileId, authorOdinId, peerNote.fileMetadata.updated,
        );
    } catch (err) {
        return { status: classifyPeerFetchError(err) };
    }
    if (!blob) {
        return { status: 'empty' };
    }

    await Promise.all([
        saveDocumentUpdate(docId, blob),
        upsertSyncRecord({
            localId: docId,
            entityType: 'note',
            remoteFileId: peerNote.fileId,
            versionTag: peerNote.fileMetadata.versionTag,
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
            encryptedKeyHeader: serializeKeyHeader(peerNote.sharedSecretEncryptedKeyHeader),
            authorOdinId,
            globalTransitId: peerNote.fileMetadata.globalTransitId || undefined,
        }),
    ]);
    documentBroadcast.notifyDocumentUpdated(docId);
    return { status: 'fetched' };
}

/**
 * Background freshness check for a peer note. The author's edits are not pushed
 * to us (that needs a live peer subscription), so on open we re-fetch the
 * author's current note and CRDT-merge it when it's newer than our copy. Safe
 * to call on every open — a no-op when the versionTag is unchanged.
 */
export async function revalidatePeerNote(
    ctx: SyncContext,
    docId: string,
    authorOdinId: string | undefined,
): Promise<'skipped' | 'unchanged' | 'updated'> {
    if (!authorOdinId || authorOdinId === ctx.hostIdentity) return 'skipped';

    let header;
    try {
        header = await ctx.notesProvider.getNote(docId, authorOdinId, { decrypt: false });
    } catch {
        return 'skipped'; // best-effort; offline/forbidden → keep the local copy
    }
    if (!header || !header.fileId) return 'skipped';

    const record = await getSyncRecord(docId);
    if (record?.versionTag && stringGuidsEqual(header.fileMetadata.versionTag, record.versionTag)) {
        return 'unchanged';
    }

    let remoteBlob: Uint8Array | null;
    try {
        remoteBlob = await ctx.notesProvider.getNotePayload(
            header.fileId, authorOdinId, header.fileMetadata.updated,
        );
    } catch {
        return 'skipped';
    }
    if (!remoteBlob) return 'skipped';

    const mergedBlob = await mergeYjsDocuments(docId, remoteBlob);
    await replaceDocumentUpdates(docId, mergedBlob);
    await upsertSyncRecord({
        localId: docId,
        entityType: 'note',
        remoteFileId: header.fileId,
        versionTag: header.fileMetadata.versionTag,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'synced',
        encryptedKeyHeader: serializeKeyHeader(header.sharedSecretEncryptedKeyHeader),
        authorOdinId,
        globalTransitId: header.fileMetadata.globalTransitId || undefined,
    });
    documentBroadcast.notifyDocumentUpdated(docId);
    return 'updated';
}

export async function handleInvitation(ctx: SyncContext, remoteFile: HomebaseFile<string>): Promise<void> {
    const content = await ctx.notesProvider.dsrToContent<CollaborationInviteContent>(remoteFile, true);
    if (!content || !content.noteUniqueId) {
        console.error('[SyncService] Invalid invitation file', remoteFile.fileId);
        return;
    }

    await bootstrapCollaborativeNote(
        ctx,
        content.noteUniqueId,
        content.authorOdinId,
        content.noteTitle,
        content.notePreview,
        content.sharedAt,
    );
}

async function bootstrapCollaborativeNote(
    ctx: SyncContext,
    noteUniqueId: string,
    authorOdinId: string,
    inviteTitle: string,
    invitePreview: string,
    sharedAt: string,
): Promise<void> {
    let peerNote;
    try {
        peerNote = await ctx.notesProvider.getNote(noteUniqueId, authorOdinId, { decrypt: true });
    } catch (err) {
        console.error(`[SyncService] bootstrapCollaborativeNote peer fetch failed for ${noteUniqueId}:`, err);
    }
    if (!peerNote || !peerNote.fileId) {
        console.warn(`[SyncService] Could not fetch peer note ${noteUniqueId} from ${authorOdinId} — author may be offline`);
        await upsertSearchIndex({
            docId: noteUniqueId,
            title: inviteTitle,
            plainTextContent: invitePreview,
            metadata: {
                title: inviteTitle,
                folderId: COLLABORATIVE_FOLDER_ID,
                tags: [],
                timestamps: { created: sharedAt, modified: sharedAt },
                excludeFromAI: true,
                isCollaborative: true,
                authorOdinId,
            },
        });
        return;
    }

    const lastModified = peerNote.fileMetadata.updated;
    const [content, remoteBlob] = await Promise.all([
        ctx.notesProvider.dsrToContent(peerNote, true),
        ctx.notesProvider.getNotePayload(peerNote.fileId, authorOdinId, lastModified),
    ]);
    const noteTitle = content?.title || inviteTitle || 'Untitled';

    const [, plainTextContent] = await Promise.all([
        remoteBlob ? saveDocumentUpdate(noteUniqueId, remoteBlob) : Promise.resolve(),
        remoteBlob
            ? extractPreviewTextFromYjs(noteUniqueId, remoteBlob)
            : Promise.resolve(invitePreview),
    ]);

    const remoteTimestamp = new Date(
        peerNote.fileMetadata.appData.userDate || Date.now()
    ).toISOString();
    const updatedAt = new Date(peerNote.fileMetadata.updated).toISOString();

    const metadata = {
        title: noteTitle,
        folderId: COLLABORATIVE_FOLDER_ID,
        tags: content?.tags || [],
        timestamps: { created: remoteTimestamp, modified: updatedAt },
        excludeFromAI: content?.excludeFromAI ?? true,
        isPinned: content?.isPinned,
        shareDescription: content?.shareDescription,
        shareIndexable: content?.shareIndexable,
        isCollaborative: true,
        circleIds: content?.circleIds,
        recipients: content?.recipients,
        lastEditedBy: content?.lastEditedBy,
        authorOdinId,
    };

    const contentHash = remoteBlob ? await computeContentHash(metadata, remoteBlob) : undefined;

    await Promise.all([
        upsertSearchIndex({
            docId: noteUniqueId,
            title: noteTitle,
            plainTextContent,
            metadata,
        }),
        upsertSyncRecord({
            localId: noteUniqueId,
            entityType: 'note',
            remoteFileId: peerNote.fileId,
            versionTag: peerNote.fileMetadata.versionTag,
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
            encryptedKeyHeader: serializeKeyHeader(peerNote.sharedSecretEncryptedKeyHeader),
            contentHash,
            authorOdinId,
            globalTransitId: peerNote.fileMetadata.globalTransitId || undefined,
        }),
    ]);
}

export async function handleDeletedInvitation(deleted: DeletedFileRef): Promise<void> {
    const uniqueId = deleted.fileMetadata.appData.uniqueId;
    if (!uniqueId) return;

    // async-parallel: independent DB operations
    await Promise.all([
        deleteSearchIndexEntry(uniqueId),
        deleteDocumentUpdates(uniqueId),
        deleteSyncRecord(uniqueId),
    ]);
}
