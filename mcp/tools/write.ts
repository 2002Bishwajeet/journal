/**
 * Pure write-tool handlers for the Journal MCP server (#169). Like mcp/tools/read.ts they
 * depend only on injected deps (mcp/drive.ts implements them against Homebase), so the
 * conflict/merge logic is unit-tested with fakes and real Yjs.
 *
 * Every edit is applied to the note's stored Yjs state (never a fresh doc), so the upload
 * is a causally-later update that the app CRDT-merges with anything typed meanwhile. The
 * upload carries the fetched versionTag; on a conflict the note is refetched and the same
 * operation re-applied to the fresh state.
 */
import * as Y from 'yjs';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import { getNewId } from '@/lib/utils';
import { folderAccess, type AgentAccess, type AgentGrants } from '@/lib/agent/grants';
import { agentEditor } from '@/lib/agent/attribution';
import {
    appendMarkdown,
    replaceInNote as replaceInDoc,
    createDoc,
    localImageSources,
    setMarkdown,
} from '@/lib/agent/editEngine';
import {
    advanceNextImageIndex,
    clearCover,
    clearDarkCover,
    getCover,
    readNextImageIndex,
    setCover,
    setDarkCover,
    type CoverImage,
    type CoverVariant,
} from '@/lib/editor/cover';
import { collectImageRefs } from '@/lib/yjs/imageRefs';
import { parseAttachmentSrc } from '@/lib/utils/attachmentSrc';
import type { PreparedImage } from '@/lib/images/imageBytes';
import type { DocumentMetadata } from '@/types';
import { loadImage } from '../imageSource';
import { noteAccess, type ReadDeps, type NoteSummary } from './read';

/** Thrown by `uploadNoteEdit` when the note's versionTag is stale. */
export class VersionConflictError extends Error {
    constructor() {
        super('Version conflict');
        this.name = 'VersionConflictError';
    }
}

export interface NoteForEdit {
    summary: NoteSummary;
    doc: Y.Doc;
    versionTag: string;
    fileId: string;
    /** The fetched file's encrypted key header, handed back to `uploadNoteEdit`. */
    keyHeader?: EncryptedKeyHeader;
    metadata: DocumentMetadata;
}

export interface NoteEdit {
    fileId: string;
    versionTag: string;
    keyHeader?: EncryptedKeyHeader;
    metadata: DocumentMetadata;
    yjsBlob: Uint8Array;
    /** Image payload keys this edit stops using, deleted with the same upload. */
    toDeletePayloads?: string[];
}

export type WriteDeps = ReadDeps & {
    fetchNoteForEdit(id: string): Promise<NoteForEdit | null>;
    uploadNoteEdit(id: string, edit: NoteEdit): Promise<void>;
    createNote(uniqueId: string, metadata: DocumentMetadata, yjsBlob: Uint8Array): Promise<void>;
    createFolder(uniqueId: string, name: string): Promise<void>;
    /**
     * Adds `image` as a new jrnl_img payload on the note's file (as the app's image upload
     * does) and returns its payload key. `minIndex` is the note's own key counter.
     */
    uploadNoteImage(id: string, versionTag: string, image: PreparedImage, minIndex: number): Promise<string>;
    /** Moves the note to Trash (Homebase archivalStatus 2), like the app's trashNote. */
    trashNote(id: string, fileId: string): Promise<void>;
    /** Sets one folder's grant in the grants file, keeping every other grant. */
    grantFolder(folderId: string, access: AgentAccess): Promise<void>;
    /** The MCP client's `clientInfo.name` from the initialize handshake ('' if absent). */
    clientName(): string;
};

const MAX_ATTEMPTS = 3;

function assertWritable(grants: AgentGrants, note: NoteForEdit | null, id: string): asserts note is NoteForEdit {
    const access = note ? noteAccess(grants, note.summary) : 'none';
    if (!note || access === 'none') throw new Error(`Note not found: ${id}`);
    if (access === 'read') throw new Error(`Note is read-only for agents: ${id}`);
}

function assertUnchangedSince(expectedModified: string | undefined, summary: NoteSummary, id: string): void {
    if (expectedModified !== undefined && Date.parse(expectedModified) !== Date.parse(summary.modified)) {
        throw new Error(`Note changed since ${expectedModified} (now ${summary.modified}); get_note it again: ${id}`);
    }
}

async function editWithRetry(
    deps: WriteDeps,
    id: string,
    // May return image payload keys the edit stops using, to delete with the upload.
    apply: (doc: Y.Doc) => string[] | void,
    opts: { metadata?: Partial<DocumentMetadata>; expectedModified?: string } = {}
): Promise<void> {
    const lastEditedBy = agentEditor(deps.clientName());
    const [grants, firstNote] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);
    let sent: { client: number; clock: number } | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Access is re-checked on every fetch: a refetched note may have become excludeFromAI.
        const note = attempt === 0 ? firstNote : await deps.fetchNoteForEdit(id);
        assertWritable(grants, note, id);

        // A conflicting upload can still have been saved (#439). If the refetched doc already
        // holds its ops, the edit is in: re-applying it would duplicate it or fail on it.
        if (sent && Y.getState(note.doc.store, sent.client) >= sent.clock) return;

        // Checked against the note as the agent's call found it; an edit landing while
        // uploading merges like any concurrent edit.
        if (attempt === 0) assertUnchangedSince(opts.expectedModified, note.summary, id);

        const toDeletePayloads = apply(note.doc) || undefined;
        const clock = Y.getState(note.doc.store, note.doc.clientID);
        // No ops of this doc's own (a title/tags-only edit, or ops merged in from an earlier
        // attempt) leaves the earlier record, if any, as what to detect.
        if (clock > 0) sent = { client: note.doc.clientID, clock };
        try {
            await deps.uploadNoteEdit(id, {
                fileId: note.fileId,
                versionTag: note.versionTag,
                keyHeader: note.keyHeader,
                metadata: { ...note.metadata, ...opts.metadata, lastEditedBy },
                yjsBlob: Y.encodeStateAsUpdate(note.doc),
                ...(toDeletePayloads?.length ? { toDeletePayloads } : {}),
            });
            return;
        } catch (err) {
            if (!(err instanceof VersionConflictError)) throw err;
        }
    }
    throw new Error(`Note changed too often while editing; try again: ${id}`);
}

/**
 * Reads and checks every local image (file path or data: URI) in `markdown`, before
 * anything is written: one bad image rejects the whole call.
 */
async function loadBodyImages(markdown: string | undefined): Promise<Map<string, PreparedImage>> {
    const loaded = new Map<string, PreparedImage>();
    for (const src of markdown ? localImageSources(markdown) : []) {
        try {
            loaded.set(src, await loadImage(src));
        } catch (err) {
            const label = src.startsWith('data:') ? 'data: URI' : src;
            throw new Error(`Image ${label}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
    }
    return loaded;
}

/**
 * `editWithRetry` for markdown that may hold local images (#415): each is uploaded as a
 * jrnl_img payload on the note's file, and `apply` gets the map from each image's local
 * source to its `attachment://` src, for the markdown converter to swap in.
 */
async function editWithBodyImages(
    deps: WriteDeps,
    id: string,
    loaded: Map<string, PreparedImage>,
    apply: (doc: Y.Doc, imageSrcs?: Map<string, string>) => string[] | void,
    opts: { metadata?: Partial<DocumentMetadata>; expectedModified?: string } = {}
): Promise<void> {
    if (loaded.size === 0) return editWithRetry(deps, id, (doc) => apply(doc), opts);

    const [grants, note] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);
    assertWritable(grants, note, id);
    // The uploads below change the file's modified time, so the check has to come first.
    assertUnchangedSince(opts.expectedModified, note.summary, id);

    const imageSrcs = new Map<string, string>();
    const payloadKeys: string[] = [];
    const minIndex = readNextImageIndex(note.doc);
    for (const [src, image] of loaded) {
        const payloadKey = await deps.uploadNoteImage(id, note.versionTag, image, minIndex);
        payloadKeys.push(payloadKey);
        imageSrcs.set(src, `attachment://${note.fileId}/${payloadKey}`);
    }
    await editWithRetry(
        deps,
        id,
        (doc) => {
            const toDelete = apply(doc, imageSrcs);
            payloadKeys.forEach((key) => advanceNextImageIndex(doc, key));
            return toDelete;
        },
        { ...opts, expectedModified: undefined }
    );
}

export async function createNote(
    deps: WriteDeps,
    params: { title: string; markdown: string; folderId: string; tags?: string[] }
): Promise<{ id: string; title: string; folderId: string }> {
    const grants = await deps.loadGrants();
    const writable =
        folderAccess(grants, params.folderId) === 'write' &&
        (await deps.listFolders()).some((folder) => folder.id === params.folderId);
    if (!writable) throw new Error(`Folder not found: ${params.folderId}`);

    const id = formatGuidId(getNewId());
    const now = new Date().toISOString();
    // Same shape as persistNewNote (src/hooks/useNotes.ts), plus the agent attribution.
    const metadata: DocumentMetadata = {
        title: params.title || 'Untitled',
        folderId: params.folderId,
        tags: params.tags ?? [],
        timestamps: { created: now, modified: now },
        excludeFromAI: false,
        isPinned: false,
        lastEditedBy: agentEditor(deps.clientName()),
    };
    const images = await loadBodyImages(params.markdown);
    if (images.size === 0) {
        await deps.createNote(id, metadata, Y.encodeStateAsUpdate(createDoc(params.markdown)));
        return { id, title: metadata.title, folderId: metadata.folderId };
    }

    // Images are payloads of the note's file, which only exists once created: create it
    // empty, then write the body like an append. A failed upload trashes the empty note.
    await deps.createNote(id, metadata, Y.encodeStateAsUpdate(createDoc('')));
    try {
        await editWithBodyImages(deps, id, images, (doc, imageSrcs) => appendMarkdown(doc, params.markdown, imageSrcs));
    } catch (err) {
        const created = await deps.fetchNoteForEdit(id).catch(() => null);
        if (created) await deps.trashNote(id, created.fileId).catch(() => undefined);
        throw err;
    }
    return { id, title: metadata.title, folderId: metadata.folderId };
}

/**
 * Creates a folder and grants the agent Read+write on it, so it can put notes there.
 * The only grant an agent ever writes, and only for a folder it just created, so no
 * existing note becomes visible. The owner can revoke it in Settings → Agent access.
 */
export async function createFolder(deps: WriteDeps, params: { name: string }): Promise<{ id: string; name: string }> {
    const name = params.name.trim();
    if (!name) throw new Error('Folder name is required');

    const id = formatGuidId(getNewId());
    await deps.createFolder(id, name);
    await deps.grantFolder(id, 'write');
    return { id, name };
}

export async function appendToNote(deps: WriteDeps, params: { id: string; markdown: string }): Promise<{ id: string }> {
    await editWithBodyImages(deps, params.id, await loadBodyImages(params.markdown), (doc, imageSrcs) =>
        appendMarkdown(doc, params.markdown, imageSrcs)
    );
    return { id: params.id };
}

/** The engine's error (no match / several matches / lossy block) reaches the agent verbatim. */
export async function replaceInNote(
    deps: WriteDeps,
    params: { id: string; old_text: string; new_text: string }
): Promise<{ id: string }> {
    await editWithBodyImages(deps, params.id, await loadBodyImages(params.new_text), (doc, imageSrcs) =>
        replaceInDoc(doc, params.old_text, params.new_text, imageSrcs)
    );
    return { id: params.id };
}

/**
 * Rewrites the body, title and/or tags as one edit on the stored Yjs state, so an open
 * editor merges it. With `expectedModified`, a note modified since is left unchanged.
 */
export async function updateNote(
    deps: WriteDeps,
    params: { id: string; markdown?: string; title?: string; tags?: string[]; expectedModified?: string }
): Promise<{ id: string }> {
    const { id, markdown, title, tags, expectedModified } = params;
    if (markdown === undefined && title === undefined && tags === undefined) {
        throw new Error('update_note: give markdown, title or tags');
    }
    const metadata: Partial<DocumentMetadata> = {
        ...(title !== undefined && { title: title || 'Untitled' }),
        ...(tags !== undefined && { tags }),
    };
    // The rewrite is diffed once, against the note as first fetched, and that update is merged
    // into any refetch: re-diffing against a refetched note would delete a concurrent edit.
    let rewrite: Uint8Array | undefined;
    const apply = (doc: Y.Doc, imageSrcs?: Map<string, string>) => {
        if (markdown === undefined) return;
        if (rewrite) return Y.applyUpdate(doc, rewrite);
        const before = Y.encodeStateVector(doc);
        setMarkdown(doc, markdown, imageSrcs);
        rewrite = Y.encodeStateAsUpdate(doc, before);
    };
    await editWithBodyImages(deps, id, await loadBodyImages(markdown), apply, { metadata, expectedModified });
    return { id };
}

/** Moves a note to Trash, where the owner can restore it. Never deletes permanently. */
export async function deleteNote(deps: WriteDeps, params: { id: string }): Promise<{ id: string; state: 'trashed' }> {
    const [grants, note] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(params.id)]);
    assertWritable(grants, note, params.id);
    await deps.trashNote(params.id, note.fileId);
    return { id: params.id, state: 'trashed' };
}

/**
 * The payload keys of `removed` images (on this note's file) that `doc` no longer uses as
 * a cover or in its body, so they are deleted as the app deletes a replaced cover.
 */
function unusedImageKeys(doc: Y.Doc, fileId: string, removed: (CoverImage | null | undefined)[]): string[] {
    const keyOf = (src: string) => parseAttachmentSrc(src, fileId)?.payloadKey;
    const cover = getCover(doc);
    const inUse = new Set([
        ...[cover, cover?.dark].map((image) => image && keyOf(image.src)),
        ...collectImageRefs(doc.getXmlFragment('prosemirror')).filter((ref) => ref.fileId === fileId).map((ref) => ref.payloadKey),
    ]);
    const keys = removed.map((image) => image && keyOf(image.src));
    return [...new Set(keys)].filter((key): key is string => !!key && !inUse.has(key));
}

const noCover = (id: string) => new Error(`Note has no cover; set the light cover before the dark one: ${id}`);

/**
 * Sets a note's cover (with `dark`, its dark-mode cover) from a local file path or a
 * data: URI (#516). The image is checked and stripped of metadata, uploaded as a jrnl_img
 * payload on the note's file, then set as the cover; a replaced cover's payload is deleted.
 */
export async function setNoteCover(
    deps: WriteDeps,
    params: { id: string; image: string; positionY?: number; dark?: boolean }
): Promise<{ id: string; variant: CoverVariant; src: string; positionY: number; note?: string }> {
    const { id, dark = false } = params;
    const positionY = Math.round(params.positionY ?? 50);
    if (!(positionY >= 0 && positionY <= 100)) throw new Error('positionY must be between 0 and 100');

    const [grants, note] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);
    assertWritable(grants, note, id);
    if (dark && !getCover(note.doc)) throw noCover(id);
    const image = await loadImage(params.image);

    const payloadKey = await deps.uploadNoteImage(id, note.versionTag, image, readNextImageIndex(note.doc));
    const next: CoverImage = { src: `attachment://${note.fileId}/${payloadKey}`, positionY };
    await editWithRetry(deps, id, (doc) => {
        const old = getCover(doc);
        if (dark) {
            if (!old) throw noCover(id);
            setDarkCover(doc, next);
        } else {
            setCover(doc, next);
        }
        advanceNextImageIndex(doc, payloadKey);
        return unusedImageKeys(doc, note.fileId, [dark ? old?.dark : old]);
    });

    // The link card is drawn from the light cover, with a canvas this server doesn't have.
    const publicNote =
        "This note is public. Its link-preview card image can't be drawn here, so link previews show " +
        'the plain cover until the note is next saved in the Journal app, which redraws the card.';
    return {
        id,
        variant: dark ? 'dark' : 'light',
        ...next,
        ...(note.metadata.isPublic && !dark ? { note: publicNote } : {}),
    };
}

/** Removes a note's cover (and its dark cover with it), or with `dark` only the dark cover. */
export async function clearNoteCover(
    deps: WriteDeps,
    params: { id: string; dark?: boolean }
): Promise<{ id: string; variant: CoverVariant; cleared: boolean }> {
    const { id, dark = false } = params;
    const variant = dark ? 'dark' : 'light';
    const [grants, note] = await Promise.all([deps.loadGrants(), deps.fetchNoteForEdit(id)]);
    assertWritable(grants, note, id);
    const cover = getCover(note.doc);
    // Nothing to clear: no upload, so the note isn't marked as edited by the agent.
    if (!(dark ? cover?.dark : cover)) return { id, variant, cleared: false };

    await editWithRetry(deps, id, (doc) => {
        const old = getCover(doc);
        if (dark) clearDarkCover(doc);
        else clearCover(doc);
        return unusedImageKeys(doc, note.fileId, dark ? [old?.dark] : [old, old?.dark]);
    });
    return { id, variant, cleared: true };
}
