/**
 * share_note and get_sharing (#325): one tool for every kind of sharing. Making a public note
 * private is applied directly; every other change is a request (`metadata.shareRequest`) the
 * owner confirms in the app's Share dialog, which runs the app's own share code. The MCP can't
 * share with people itself: that needs the app's collaboration permissions and circles.
 */
import { agentEditor } from '@/lib/agent/attribution';
import { isOdinId, normalizeOdinId } from '@/lib/homebase/shareTargets';
import { accessFromMetadata, PERSON_EDITORS_SUPPORTED, sameAccess, type AccessEntry, type ShareRole } from '@/lib/share/shareAccess';
import type { DocumentMetadata, ShareRequest } from '@/types';
import { noteAccess } from './read';
import { assertWritable, editWithRetry, type NoteForEdit, type WriteDeps } from './write';

export type ShareKind = ShareRequest['access'];

export interface ShareEntryInput {
    kind: 'person' | 'circle';
    id: string;
    role?: ShareRole;
}

export interface SharingState {
    id: string;
    access: ShareKind;
    link?: string;
    with: AccessEntry[];
    inSharedFolder: boolean;
    pending?: { access: ShareKind; with?: AccessEntry[]; by: string; at: string };
}

export interface ShareResult {
    id: string;
    status: 'shared' | 'pending' | 'unchanged';
    access: ShareKind;
    link?: string;
    with?: AccessEntry[];
    note?: string;
}

const kindOf = (metadata: DocumentMetadata): ShareKind =>
    metadata.isPublic ? 'public' : accessFromMetadata(metadata).length > 0 ? 'people' : 'private';

const PENDING_NOTE = 'Nothing is shared until the owner confirms it in Journal.';

async function inSharedFolder(deps: WriteDeps, note: NoteForEdit): Promise<string | undefined> {
    const folder = (await deps.listFolders()).find((f) => f.id === note.metadata.folderId);
    return folder?.isPublic ? folder.name : undefined;
}

/** The note's sharing as the Share dialog shows it, and a request waiting for the owner. */
export async function getSharing(deps: WriteDeps, { id }: { id: string }): Promise<SharingState> {
    const [grants, note] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);
    if (!note || noteAccess(grants, note.summary) === 'none') throw new Error(`Note not found: ${id}`);
    const access = kindOf(note.metadata);
    const request = note.metadata.shareRequest;
    return {
        id,
        access,
        ...(access !== 'private' && { link: deps.shareLink(id) }),
        with: accessFromMetadata(note.metadata),
        inSharedFolder: (await inSharedFolder(deps, note)) !== undefined,
        ...(request && {
            pending: { access: request.access, ...(request.with && { with: request.with }), by: request.by, at: new Date(request.at).toISOString() },
        }),
    };
}

/** `with` as the share stores it, or why it can't be shared with. */
function targetEntries(deps: WriteDeps, entries: ShareEntryInput[]): AccessEntry[] {
    if (entries.length === 0) throw new Error('share_note: access "people" needs at least one person or circle in `with`');
    const owner = normalizeOdinId(deps.ownerIdentity());
    return entries.map(({ kind, id, role = 'viewer' }): AccessEntry => {
        if (kind === 'circle') {
            const circle = id.trim();
            if (!circle) throw new Error('share_note: a circle needs its id or name');
            return { kind, id: circle, role };
        }
        const odinId = normalizeOdinId(id);
        if (!isOdinId(odinId)) throw new Error(`share_note: ${id} is not a Homebase identity`);
        if (odinId === owner) throw new Error("share_note: a note can't be shared with its owner");
        if (role === 'editor' && !PERSON_EDITORS_SUPPORTED) {
            throw new Error(`share_note: a person can only be a viewer for now; share with a circle to let ${odinId} edit`);
        }
        return { kind, id: odinId, role };
    });
}

/**
 * Sets who can see a note: `private`, `public` (anyone with the link) or `people` (the full
 * set in `with`). Only public → private is applied here; any other change leaves a request
 * for the owner to confirm, replacing an older one, and needs the owner's opt-in.
 */
export async function shareNote(
    deps: WriteDeps,
    params: { id: string; access: ShareKind; with?: ShareEntryInput[] }
): Promise<ShareResult> {
    const { id, access } = params;
    if (access !== 'people' && params.with !== undefined) throw new Error(`share_note: \`with\` is only for access "people", not "${access}"`);
    const target = access === 'people' ? targetEntries(deps, params.with ?? []) : [];

    const [grants, note] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);
    assertWritable(grants, note, id);
    const { metadata } = note;
    const owner = normalizeOdinId(deps.ownerIdentity());
    if (metadata.authorOdinId && normalizeOdinId(metadata.authorOdinId) !== owner) {
        throw new Error(`share_note: only the owner can share a note shared with them: ${id}`);
    }

    const current = kindOf(metadata);
    const link = deps.shareLink(id);
    const unchanged = access === current && (access !== 'people' || sameAccess(accessFromMetadata(metadata), target));
    if (unchanged) {
        // What the agent asks for is already so, so an older request is dropped.
        if (metadata.shareRequest) await editWithRetry(deps, id, () => {}, { metadata: { shareRequest: undefined } });
        return { id, status: 'unchanged', access, ...(access !== 'private' && { link }), ...(access === 'people' && { with: target }) };
    }

    const folder = await inSharedFolder(deps, note);
    if (folder !== undefined) {
        throw new Error(`share_note: the note is public because it is in the shared folder ${folder}; move it out with update_note folderId first`);
    }

    if (access === 'private' && current === 'public') {
        await deps.setNotePublic(id, note.fileId, false);
        return { id, status: 'shared', access, note: 'The note is private again: its public link no longer opens it.' };
    }

    if (!grants.allowShareRequests) {
        throw new Error(
            'share_note: the owner has not let agents ask to share notes. Ask them to turn on "Let agents ask to share notes" in Journal → Settings → Agent access.'
        );
    }
    if (current === 'public') {
        // A public note's stored content is world-readable, so a request can't ride on it.
        throw new Error('share_note: the note is public. Make it private first (access "private"), then ask to share it with people.');
    }

    const shareRequest: ShareRequest = {
        access,
        ...(access === 'people' && { with: target }),
        by: agentEditor(deps.clientName()),
        at: Date.now(),
    };
    await editWithRetry(deps, id, () => {}, { metadata: { shareRequest } });
    const asked =
        access === 'public'
            ? `Asked the owner to make the note public: anyone on the web could read it.${current === 'people' ? ' The people it is shared with would lose access.' : ''}`
            : access === 'people'
              ? 'Asked the owner to share the note with these people.'
              : 'Asked the owner to stop sharing the note.';
    return {
        id,
        status: 'pending',
        access,
        ...(access !== 'private' && { link }),
        ...(access === 'people' && { with: target }),
        note: `${asked} ${PENDING_NOTE}`,
    };
}
