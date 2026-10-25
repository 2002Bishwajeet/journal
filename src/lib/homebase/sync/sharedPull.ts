import type { DotYouClient, HomebaseFile } from '@homebase-id/js-lib/core';
import { getConnections } from '@homebase-id/js-lib/network';
import { queryModifiedOverPeer } from '@homebase-id/js-lib/peer';
import { getAppState, saveAppState, getSharedNoteIdsFrom } from '@/lib/db';
import type { NoteFileContent } from '@/types';
import { JOURNAL_DRIVE, JOURNAL_FILE_TYPE } from '../config';
import type { SyncContext } from './context';
import { bootstrapCollaborativeNote, removeLocalPeerNote } from './peerNotes';

/**
 * "Shared with me" from the owners' side (#732): each connection's Journal drive is
 * queried over peer, and its server returns only the notes whose ACL admits the
 * host. That finds new shares without an invite landing here, and the daily full
 * pass removes the notes an owner no longer shares (revoke).
 */

export const SHARED_PULL_STATE_KEY = 'sharedPullState';

const CONCURRENCY = 4;
const PAGE_SIZE = 100;
const MIN_BACKOFF_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60_000;
const FULL_PASS_INTERVAL_MS = 24 * 60 * 60_000;

interface OwnerState {
    cursor?: string;
    failures: number;
    nextAttemptAt: number;
}

/** One app_state row: a PGlite write costs an IndexedDB flush, so it is written at most once per pass. */
interface SharedPullState {
    owners: Record<string, OwnerState>;
    fullPassAt?: number;
}

export interface SharedPullOptions {
    /** Without ReadConnections (base consent from #743 on) the pass makes no calls. */
    canReadConnections: boolean;
    /** The "Refresh" button: ignores backoff and runs the full pass. */
    manual?: boolean;
}

// Passes share the state row, so they run one after another.
let queue: Promise<unknown> = Promise.resolve();
function serialize(run: () => Promise<void>): Promise<void> {
    const next = queue.then(run);
    queue = next.catch(() => undefined);
    return next;
}

/** Pull from every connection whose backoff has ended. */
export function pullShared(ctx: SyncContext, client: DotYouClient, options: SharedPullOptions): Promise<void> {
    if (!options.canReadConnections) return Promise.resolve();
    return serialize(async () => {
        const state = await loadState();
        const now = Date.now();
        const full = !!options.manual || now - (state.fullPassAt ?? 0) >= FULL_PASS_INTERVAL_MS;
        const owners = (await listConnections(client))
            .filter((odinId) => options.manual || (state.owners[odinId]?.nextAttemptAt ?? 0) <= now);
        let changed = await pullOwners(ctx, client, state, owners, full);
        if (full) {
            state.fullPassAt = now;
            changed = true;
        }
        if (changed) await saveAppState(SHARED_PULL_STATE_KEY, state);
    });
}

/**
 * Pull from one owner now, ignoring its backoff (a share push arrived, #745).
 * Rejects when the owner did not answer, so the caller can keep the push unread.
 */
export function pullOwnerNow(ctx: SyncContext, client: DotYouClient, odinId: string): Promise<void> {
    return serialize(async () => {
        const state = await loadState();
        if (await pullOwners(ctx, client, state, [odinId], false)) {
            await saveAppState(SHARED_PULL_STATE_KEY, state);
        }
        if (state.owners[odinId]?.failures) throw new Error(`${odinId} did not answer`);
    });
}

async function loadState(): Promise<SharedPullState> {
    return (await getAppState<SharedPullState>(SHARED_PULL_STATE_KEY)) ?? { owners: {} };
}

async function listConnections(client: DotYouClient): Promise<string[]> {
    const odinIds: string[] = [];
    let cursor: unknown;
    for (;;) {
        const page = await getConnections(client, { count: PAGE_SIZE, cursor });
        odinIds.push(...page.results.map((connection) => connection.odinId));
        if (page.results.length < PAGE_SIZE || !page.cursor) return odinIds;
        cursor = page.cursor;
    }
}

/** Updates `state` in place; true when it changed. */
async function pullOwners(
    ctx: SyncContext,
    client: DotYouClient,
    state: SharedPullState,
    owners: string[],
    full: boolean,
): Promise<boolean> {
    let changed = false;
    const pullOne = async (owner: string) => {
        const before = state.owners[owner];
        let after: OwnerState;
        try {
            const { cursor, shared } = await queryShared(ctx, client, owner, full ? undefined : before?.cursor);
            for (const [uniqueId, { title, updated }] of shared) {
                await bootstrapCollaborativeNote(ctx, uniqueId, owner, title, '', new Date(updated).toISOString());
            }
            if (full) {
                for (const docId of await getSharedNoteIdsFrom(owner)) {
                    if (!shared.has(docId)) await removeLocalPeerNote(docId);
                }
            }
            after = { cursor: cursor ?? before?.cursor, failures: 0, nextAttemptAt: 0 };
        } catch (error) {
            console.warn(`[sharedPull] ${owner} did not answer:`, error);
            const failures = (before?.failures ?? 0) + 1;
            const backoff = Math.min(MIN_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
            after = { cursor: before?.cursor, failures, nextAttemptAt: Date.now() + backoff };
        }
        if (before?.cursor !== after.cursor || before?.failures !== after.failures
            || before?.nextAttemptAt !== after.nextAttemptAt) {
            state.owners[owner] = after;
            changed = true;
        }
    };
    for (let i = 0; i < owners.length; i += CONCURRENCY) {
        await Promise.all(owners.slice(i, i + CONCURRENCY).map(pullOne));
    }
    return changed;
}

type SharedFile = { title: string; updated: number };

/** Every note `owner` shares with the host modified since `cursor`, by uniqueId. */
async function queryShared(
    ctx: SyncContext,
    client: DotYouClient,
    owner: string,
    cursor: string | undefined,
): Promise<{ cursor: string | undefined; shared: Map<string, SharedFile> }> {
    const shared = new Map<string, SharedFile>();
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
        if (page.searchResults.length < PAGE_SIZE || next === cursor) return { cursor: next, shared };
        cursor = next;
    }
}

/**
 * The note's content when it is shared with the host: encrypted, collaborative, and
 * shared with a circle or with the host by name. Public notes and the rest are ignored.
 */
async function sharedContent(ctx: SyncContext, file: HomebaseFile, owner: string): Promise<NoteFileContent | null> {
    if (!file.fileMetadata.isEncrypted) return null;
    // Share-circle members can write to the owner's drive (#730): only the owner's own notes count
    const sender = file.fileMetadata.senderOdinId;
    if (sender && sender !== owner) return null;
    const content = await ctx.notesProvider.dsrToContent<NoteFileContent>(file, true);
    if (content?.isCollaborative !== true) return null;
    const forHost = content.recipients?.includes(ctx.hostIdentity) || (content.circleIds?.length ?? 0) > 0;
    return forHost ? content : null;
}
