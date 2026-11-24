import type { DotYouClient, HomebaseFile } from '@homebase-id/js-lib/core';
import { queryModifiedOverPeer } from '@homebase-id/js-lib/peer';
import { getSharedNoteIdsFrom } from '@/lib/db';
import type { NoteFileContent } from '@/types';
import { JOURNAL_DRIVE, JOURNAL_FILE_TYPE } from '../config';
import type { SyncContext } from './context';
import {
    bootstrapCollaborativeNote,
    classifyPeerFetchError,
    forgetUnsharedDismissals,
    removeLocalPeerNote,
    revalidatePeerNote,
} from './peerNotes';

/**
 * "Shared with me" from the owners' side (#732): one owner's Journal drive is queried
 * over peer, and its server returns only the notes whose ACL admits the host. Nothing
 * polls (#1494): an owner is pulled only for a reason, a share push or invite from them,
 * a share link to their note, or Refresh for an owner the host already has notes from.
 */

const PAGE_SIZE = 100;

// Two pulls of one owner would import the same notes twice, so they run one after another.
let queue: Promise<unknown> = Promise.resolve();
function serialize(run: () => Promise<void>): Promise<void> {
    const next = queue.then(run);
    queue = next.catch(() => undefined);
    return next;
}

/**
 * Pull from one owner: imports the notes it shares with the host and drops the local
 * ones it no longer returns (revoke). Rejects when the owner did not answer, so the
 * caller can keep the push unread.
 */
export function pullOwnerNow(ctx: SyncContext, client: DotYouClient, owner: string): Promise<void> {
    return serialize(async () => {
        let shared: Map<string, SharedFile>;
        try {
            shared = await queryShared(ctx, client, owner);
        } catch (error) {
            console.warn(`[sharedPull] ${owner} did not answer:`, error);
            // Refused: the owner took the host off every share, and with it the drive access
            // (#897). Check each of their notes here on its own, which drops the unshared ones.
            if (classifyPeerFetchError(error) === 'forbidden') {
                try {
                    await revalidateNotesFrom(ctx, owner);
                    await forgetUnsharedDismissals(owner, new Set());
                } catch (err) {
                    console.warn(`[sharedPull] Could not check the notes from ${owner}:`, err);
                }
            }
            throw new Error(`${owner} did not answer`, { cause: error });
        }
        for (const [uniqueId, { title, updated }] of shared) {
            await bootstrapCollaborativeNote(ctx, uniqueId, owner, title, '', new Date(updated).toISOString());
        }
        for (const docId of await getSharedNoteIdsFrom(owner)) {
            if (!shared.has(docId)) await removeLocalPeerNote(docId);
        }
        await forgetUnsharedDismissals(owner, new Set(shared.keys()));
    });
}

/**
 * The owner stopped sharing a note with the host (an unshare push, #1494): checks each of
 * their notes here against the owner, which drops the ones the host can no longer read.
 */
export function revalidateOwner(ctx: SyncContext, owner: string): Promise<void> {
    return serialize(() => revalidateNotesFrom(ctx, owner));
}

async function revalidateNotesFrom(ctx: SyncContext, owner: string): Promise<void> {
    for (const docId of await getSharedNoteIdsFrom(owner)) await revalidatePeerNote(ctx, docId, owner);
}

type SharedFile = { title: string; updated: number };

/** Every note `owner` shares with the host, by uniqueId. */
async function queryShared(ctx: SyncContext, client: DotYouClient, owner: string): Promise<Map<string, SharedFile>> {
    const shared = new Map<string, SharedFile>();
    let cursor: string | undefined;
    for (;;) {
        // A first call must omit the cursor: `cursor: 0` is a 400.
        const page = await queryModifiedOverPeer(
            client,
            owner,
            { targetDrive: JOURNAL_DRIVE, fileType: [JOURNAL_FILE_TYPE] },
            { maxRecords: PAGE_SIZE, includeHeaderContent: true, cursor },
        );
        for (const file of page.searchResults) {
            const uniqueId = file.fileMetadata.appData.uniqueId;
            const content = file.fileState === 'active' ? await sharedContent(ctx, file, owner) : null;
            if (uniqueId && content) shared.set(uniqueId, { title: content.title, updated: file.fileMetadata.updated });
        }
        const next = page.cursor ? String(page.cursor) : cursor;
        if (page.searchResults.length < PAGE_SIZE || next === cursor) return shared;
        cursor = next;
    }
}

/**
 * The note's content when it is shared with the host: encrypted, collaborative, and
 * shared with a circle or naming the host as an editor or a viewer (#897). Public notes
 * and the rest are ignored.
 */
async function sharedContent(ctx: SyncContext, file: HomebaseFile, owner: string): Promise<NoteFileContent | null> {
    if (!file.fileMetadata.isEncrypted) return null;
    // Share-circle members can write to the owner's drive (#730): only the owner's own notes count
    const sender = file.fileMetadata.senderOdinId;
    if (sender && sender !== owner) return null;
    const content = await ctx.notesProvider.dsrToContent<NoteFileContent>(file, true);
    if (content?.isCollaborative !== true) return null;
    const forHost = content.recipients?.includes(ctx.hostIdentity)
        || content.odinIds?.includes(ctx.hostIdentity)
        || content.viewerRecipients?.includes(ctx.hostIdentity)
        || (content.circleIds?.length ?? 0) > 0
        || (content.viewerCircleIds?.length ?? 0) > 0;
    return forHost ? content : null;
}
