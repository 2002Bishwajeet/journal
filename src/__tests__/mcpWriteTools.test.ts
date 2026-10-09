import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import {
    appendToNote,
    replaceInNote,
    createNote,
    createFolder,
    updateNote,
    deleteNote,
    setNoteCover,
    clearNoteCover,
    VersionConflictError,
    type WriteDeps,
} from '../../mcp/tools/write';
import type { NoteSummary } from '../../mcp/tools/read';
import type { AgentAccess, AgentGrants } from '@/lib/agent/grants';
import type { DocumentMetadata } from '@/types';
import { createDoc, appendMarkdown, toMarkdown } from '@/lib/agent/editEngine';
import { advanceNextImageIndex, getCoverFromBlob, readNextImageIndex, setCover, setDarkCover } from '@/lib/editor/cover';
import type { PreparedImage } from '@/lib/images/imageBytes';

// FW granted write, FR granted read, FN has no grant.
const GRANTS: AgentGrants = { version: 1, folders: { FW: 'write', FR: 'read' }, notes: {} };
const FOLDERS = [
    { id: 'FW', name: 'Writable' },
    { id: 'FR', name: 'Readable' },
    { id: 'FN', name: 'Hidden' },
];

function metadataFor(folderId: string, overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
    return {
        title: 'Work log',
        folderId,
        tags: ['work'],
        timestamps: { created: '2024-01-01T00:00:00.000Z', modified: '2024-01-02T00:00:00.000Z' },
        excludeFromAI: false,
        isPinned: true,
        isPublic: false,
        isCollaborative: true,
        circleIds: ['circle-1'],
        recipients: ['friend.dotyou.cloud'],
        archivalStatus: 0,
        lastEditedBy: 'owner.dotyou.cloud',
        ...overrides,
    };
}

interface StoredNote {
    blob: Uint8Array;
    versionTag: number;
    metadata: DocumentMetadata;
}

interface Upload {
    id: string;
    fileId: string;
    versionTag: string;
    metadata: DocumentMetadata;
    yjsBlob: Uint8Array;
    toDeletePayloads?: string[];
}

/**
 * A fake drive: each fetch decodes a fresh Y.Doc from the stored blob (like the real
 * payload download), and an upload with a stale versionTag throws VersionConflictError.
 * `beforeUpload` lets a test change the stored note between fetch and upload, i.e. a
 * human edit landing on the server while the agent is editing.
 */
function makeDrive(opts: { clientName?: string; beforeUpload?: (store: Map<string, StoredNote>, attempt: number) => void } = {}) {
    const store = new Map<string, StoredNote>();
    const uploads: Upload[] = [];
    const creates: { uniqueId: string; metadata: DocumentMetadata; yjsBlob: Uint8Array }[] = [];
    const folderCreates: { uniqueId: string; name: string }[] = [];
    const folderGrants: { folderId: string; access: AgentAccess }[] = [];
    const trashed: { id: string; fileId: string }[] = [];
    const images: { id: string; versionTag: string; image: PreparedImage; payloadKey: string }[] = [];
    let uploadAttempts = 0;

    function put(id: string, markdown: string, metadata: DocumentMetadata) {
        store.set(id, { blob: Y.encodeStateAsUpdate(createDoc(markdown)), versionTag: 1, metadata });
    }

    const summaryOf = (id: string, note: StoredNote): NoteSummary => ({
        id,
        title: note.metadata.title,
        folderId: note.metadata.folderId,
        tags: note.metadata.tags ?? [],
        modified: note.metadata.timestamps.modified,
        excludeFromAI: note.metadata.excludeFromAI,
    });

    const deps: WriteDeps = {
        loadGrants: async () => GRANTS,
        listFolders: async () => FOLDERS,
        listNotes: async () => [...store.entries()].map(([id, note]) => summaryOf(id, note)),
        getNote: async () => null,
        fetchNoteForEdit: async (id) => {
            const note = store.get(id);
            if (!note) return null;
            const doc = new Y.Doc();
            Y.applyUpdate(doc, note.blob);
            return {
                summary: summaryOf(id, note),
                doc,
                versionTag: String(note.versionTag),
                fileId: `file-${id}`,
                metadata: structuredClone(note.metadata),
            };
        },
        uploadNoteEdit: async (id, edit) => {
            uploadAttempts++;
            opts.beforeUpload?.(store, uploadAttempts);
            uploads.push({ id, ...edit });
            const note = store.get(id)!;
            if (edit.versionTag !== String(note.versionTag)) throw new VersionConflictError();
            store.set(id, { blob: edit.yjsBlob, versionTag: note.versionTag + 1, metadata: edit.metadata });
        },
        createNote: async (uniqueId, metadata, yjsBlob) => {
            creates.push({ uniqueId, metadata, yjsBlob });
        },
        createFolder: async (uniqueId, name) => {
            folderCreates.push({ uniqueId, name });
        },
        grantFolder: async (folderId, access) => {
            folderGrants.push({ folderId, access });
        },
        uploadNoteImage: async (id, versionTag, image, minIndex) => {
            // Like addImageToNote: a new payload changes the file's versionTag.
            const payloadKey = `jrnl_img${minIndex}`;
            images.push({ id, versionTag, image, payloadKey });
            const note = store.get(id)!;
            store.set(id, { ...note, versionTag: note.versionTag + 1 });
            return payloadKey;
        },
        trashNote: async (id, fileId) => {
            trashed.push({ id, fileId });
            store.delete(id); // gone from the agent's view, like the real drive's lists
        },
        clientName: () => opts.clientName ?? '',
    };

    /** A note whose doc is built by `build` (e.g. with a cover). */
    function putDoc(id: string, build: (doc: Y.Doc) => void, metadata: DocumentMetadata) {
        const doc = createDoc('Body');
        build(doc);
        store.set(id, { blob: Y.encodeStateAsUpdate(doc), versionTag: 1, metadata });
    }

    return { deps, store, uploads, creates, folderCreates, folderGrants, trashed, images, put, putDoc };
}

function markdownOf(blob: Uint8Array): string {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, blob);
    return toMarkdown(doc);
}

/** A human edit on the server: append to the stored doc (causally after it) and bump the versionTag. */
function humanAppends(store: Map<string, StoredNote>, id: string, markdown: string) {
    const note = store.get(id)!;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, note.blob);
    appendMarkdown(doc, markdown);
    store.set(id, { ...note, blob: Y.encodeStateAsUpdate(doc), versionTag: note.versionTag + 1 });
}

describe('write tools: access', () => {
    it('append_to_note on a read note rejects as read-only and never uploads', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nr', 'Readable body', metadataFor('FR'));
        await expect(appendToNote(deps, { id: 'nr', markdown: 'x' })).rejects.toThrow('Note is read-only for agents: nr');
        expect(uploads).toHaveLength(0);
    });

    it('append_to_note on an ungranted note rejects exactly like an unknown id', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nn', 'Hidden body', metadataFor('FN'));
        const ungranted = await appendToNote(deps, { id: 'nn', markdown: 'x' }).catch((e: Error) => e.message);
        const unknown = await appendToNote(deps, { id: 'missing', markdown: 'x' }).catch((e: Error) => e.message);
        expect(ungranted).toBe('Note not found: nn');
        expect(unknown).toBe('Note not found: missing');
        expect(uploads).toHaveLength(0);
    });

    it('an excludeFromAI note in a write folder is always refused as not found', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nx', 'Private body', metadataFor('FW', { excludeFromAI: true }));
        await expect(appendToNote(deps, { id: 'nx', markdown: 'x' })).rejects.toThrow('Note not found: nx');
        await expect(replaceInNote(deps, { id: 'nx', old_text: 'Private', new_text: 'Public' })).rejects.toThrow(
            'Note not found: nx'
        );
        expect(uploads).toHaveLength(0);
    });

    it('replace_in_note on a read note rejects as read-only', async () => {
        const { deps, put } = makeDrive();
        put('nr', 'Readable body', metadataFor('FR'));
        await expect(replaceInNote(deps, { id: 'nr', old_text: 'Readable', new_text: 'x' })).rejects.toThrow(
            'Note is read-only for agents: nr'
        );
    });

    it('create_note in a read, ungranted or missing folder rejects as folder not found', async () => {
        const { deps, creates } = makeDrive();
        for (const folderId of ['FR', 'FN', 'nope']) {
            await expect(createNote(deps, { title: 't', markdown: 'b', folderId })).rejects.toThrow(`Folder not found: ${folderId}`);
        }
        expect(creates).toHaveLength(0);
    });
});

describe('write tools: conflict-safe upload', () => {
    it('on a version conflict, refetches and re-applies to the fresh doc so the human edit survives', async () => {
        const { deps, put, store, uploads } = makeDrive({
            beforeUpload: (s, attempt) => {
                if (attempt === 1) humanAppends(s, 'nw', 'Human typed this');
            },
        });
        put('nw', 'Original line', metadataFor('FW'));

        await appendToNote(deps, { id: 'nw', markdown: 'Agent appended this' });

        expect(uploads).toHaveLength(2);
        expect(uploads[0].versionTag).toBe('1');
        expect(uploads[1].versionTag).toBe('2');
        const final = markdownOf(uploads[1].yjsBlob);
        expect(final).toContain('Original line');
        expect(final).toContain('Human typed this');
        expect(final.split('Agent appended this')).toHaveLength(2); // applied exactly once
        expect(store.get('nw')!.blob).toBe(uploads[1].yjsBlob);
    });

    it('the uploaded blob is causally after the stored state and merges with an unsynced human edit', async () => {
        const { deps, put, store, uploads } = makeDrive();
        put('nw', 'Original line', metadataFor('FW'));

        // The human's open editor holds the stored state plus a line not yet pushed.
        const human = new Y.Doc();
        Y.applyUpdate(human, store.get('nw')!.blob);
        appendMarkdown(human, 'Typed offline');

        await appendToNote(deps, { id: 'nw', markdown: 'Agent line' });

        // What the app's pull does (SyncService.mergeYjsDocuments): apply the remote blob onto local state.
        Y.applyUpdate(human, uploads[0].yjsBlob);
        const merged = toMarkdown(human);
        expect(merged.split('Original line')).toHaveLength(2);
        expect(merged).toContain('Typed offline');
        expect(merged).toContain('Agent line');
    });

    it('3 consecutive conflicts reject with "changed too often"', async () => {
        const { deps, put, uploads } = makeDrive({
            beforeUpload: (s) => humanAppends(s, 'nw', 'another human edit'),
        });
        put('nw', 'Original line', metadataFor('FW'));

        await expect(appendToNote(deps, { id: 'nw', markdown: 'Agent line' })).rejects.toThrow(
            'Note changed too often while editing; try again: nw'
        );
        expect(uploads).toHaveLength(3);
    });

    it('a non-conflict upload error propagates without retrying', async () => {
        const { deps, put } = makeDrive();
        put('nw', 'Original line', metadataFor('FW'));
        let calls = 0;
        deps.uploadNoteEdit = async () => {
            calls++;
            throw new Error('network down');
        };
        await expect(appendToNote(deps, { id: 'nw', markdown: 'x' })).rejects.toThrow('network down');
        expect(calls).toBe(1);
    });

    it('replace_in_note re-applies the replacement after a conflict', async () => {
        const { deps, put, uploads } = makeDrive({
            beforeUpload: (s, attempt) => {
                if (attempt === 1) humanAppends(s, 'nw', 'Human line');
            },
        });
        put('nw', 'Status: draft', metadataFor('FW'));

        await replaceInNote(deps, { id: 'nw', old_text: 'draft', new_text: 'done' });

        const final = markdownOf(uploads[1].yjsBlob);
        expect(final).toContain('Status: done');
        expect(final).not.toContain('draft');
        expect(final).toContain('Human line');
    });

    // #439: the upload is saved but answered with a conflict, so the retry's refetch already holds the edit.
    function committedThenConflict(drive: ReturnType<typeof makeDrive>) {
        const upload = drive.deps.uploadNoteEdit;
        let calls = 0;
        drive.deps.uploadNoteEdit = async (id, edit) => {
            await upload(id, edit);
            if (++calls === 1) throw new VersionConflictError();
        };
    }

    it('replace_in_note succeeds when the conflicting upload had already been saved', async () => {
        const drive = makeDrive();
        drive.put('nw', 'Plain paragraph', metadataFor('FW'));
        committedThenConflict(drive);

        await replaceInNote(drive.deps, { id: 'nw', old_text: 'Plain paragraph', new_text: '> [!info]\n> Plain paragraph' });

        expect(drive.uploads).toHaveLength(1);
        expect(markdownOf(drive.store.get('nw')!.blob)).toContain('[!info]');
    });

    it('update_note uploads once when the conflicting upload had already been saved', async () => {
        const drive = makeDrive();
        drive.put('nw', 'Old body', metadataFor('FW'));
        committedThenConflict(drive);

        await updateNote(drive.deps, { id: 'nw', markdown: 'New body\n\nSecond' });

        expect(drive.uploads).toHaveLength(1);
        expect(markdownOf(drive.store.get('nw')!.blob)).toBe('New body\n\nSecond');
    });

    it('append_to_note does not append twice when the conflicting upload had already been saved', async () => {
        const drive = makeDrive();
        drive.put('nw', 'Original line', metadataFor('FW'));
        committedThenConflict(drive);

        await appendToNote(drive.deps, { id: 'nw', markdown: 'Agent line' });

        expect(drive.uploads).toHaveLength(1);
        expect(markdownOf(drive.store.get('nw')!.blob).split('Agent line')).toHaveLength(2);
    });
});

describe('write tools: metadata and attribution', () => {
    it('sets lastEditedBy to agent:<normalized client name> and carries every other field over', async () => {
        const { deps, put, uploads } = makeDrive({ clientName: 'Claude-Code' });
        const fetched = metadataFor('FW');
        put('nw', 'Original line', fetched);

        await appendToNote(deps, { id: 'nw', markdown: 'Agent line' });

        expect(uploads[0].metadata.lastEditedBy).toBe('agent:claude-code');
        expect({ ...uploads[0].metadata, lastEditedBy: fetched.lastEditedBy }).toEqual(fetched);
        expect(uploads[0].fileId).toBe('file-nw');
    });

    it('falls back to agent:agent when the client sent no name', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nw', 'Original line', metadataFor('FW'));
        await appendToNote(deps, { id: 'nw', markdown: 'Agent line' });
        expect(uploads[0].metadata.lastEditedBy).toBe('agent:agent');
    });

    it('normalizes odd client names to [a-z0-9-], max 40 chars', async () => {
        const { deps, put, uploads } = makeDrive({ clientName: `Claude Desktop/1.0 ${'x'.repeat(60)}` });
        put('nw', 'Original line', metadataFor('FW'));
        await appendToNote(deps, { id: 'nw', markdown: 'Agent line' });
        const name = uploads[0].metadata.lastEditedBy!.slice('agent:'.length);
        expect(name).toMatch(/^[a-z0-9-]{1,40}$/);
        expect(name.startsWith('claude-desktop-1-0-')).toBe(true);
    });

    it('create_note builds exactly the metadata an app-created note has, plus lastEditedBy', async () => {
        const { deps, creates } = makeDrive({ clientName: 'codex' });

        const result = await createNote(deps, { title: 'Standup', markdown: '# Today\n\n- shipped', folderId: 'FW' });

        expect(creates).toHaveLength(1);
        const { uniqueId, metadata, yjsBlob } = creates[0];
        expect(result).toEqual({ id: uniqueId, title: 'Standup', folderId: 'FW' });
        expect(uniqueId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(Object.keys(metadata).sort()).toEqual(
            ['excludeFromAI', 'folderId', 'isPinned', 'lastEditedBy', 'tags', 'timestamps', 'title'].sort()
        );
        expect(metadata).toMatchObject({
            title: 'Standup',
            folderId: 'FW',
            tags: [],
            excludeFromAI: false,
            isPinned: false,
            lastEditedBy: 'agent:codex',
        });
        expect(metadata.timestamps.created).toBe(metadata.timestamps.modified);
        expect(markdownOf(yjsBlob)).toContain('shipped');
    });

    it('create_note passes tags through', async () => {
        const { deps, creates } = makeDrive();
        await createNote(deps, { title: 'T', markdown: 'b', folderId: 'FW', tags: ['a', 'b'] });
        expect(creates[0].metadata.tags).toEqual(['a', 'b']);
    });
});

describe('write tools: create_folder', () => {
    it('creates the folder and grants the agent write on it, and only it', async () => {
        const { deps, folderCreates, folderGrants } = makeDrive();

        const result = await createFolder(deps, { name: '  Research  ' });

        expect(folderCreates).toEqual([{ uniqueId: result.id, name: 'Research' }]);
        expect(folderGrants).toEqual([{ folderId: result.id, access: 'write' }]);
        expect(result.name).toBe('Research');
    });

    it('rejects a blank name without creating anything', async () => {
        const { deps, folderCreates, folderGrants } = makeDrive();
        await expect(createFolder(deps, { name: '   ' })).rejects.toThrow('Folder name is required');
        expect(folderCreates).toHaveLength(0);
        expect(folderGrants).toHaveLength(0);
    });
});

describe('write tools: engine errors', () => {
    it('replace_in_note with 2 matches returns the engine message verbatim and does not upload', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nw', 'todo one\n\ntodo two', metadataFor('FW'));
        await expect(replaceInNote(deps, { id: 'nw', old_text: 'todo', new_text: 'done' })).rejects.toThrow(
            /^replace_in_note: old_text matches 2 times; include more surrounding text$/
        );
        expect(uploads).toHaveLength(0);
    });
});

describe('write tools: update_note (#511)', () => {
    it('rewrites the body, title and tags in one upload, keeping every other field', async () => {
        const { deps, put, uploads } = makeDrive({ clientName: 'claude-code' });
        const fetched = metadataFor('FW');
        put('nw', 'Old plan\n\nDay two', fetched);

        await expect(
            updateNote(deps, { id: 'nw', markdown: '# New plan\n\nDay two', title: 'Trip v2', tags: ['trip'] })
        ).resolves.toEqual({ id: 'nw' });

        expect(uploads).toHaveLength(1);
        expect(markdownOf(uploads[0].yjsBlob)).toBe('# New plan\n\nDay two');
        expect(uploads[0].metadata).toEqual({ ...fetched, title: 'Trip v2', tags: ['trip'], lastEditedBy: 'agent:claude-code' });
    });

    it('a title-only update leaves the body alone', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nw', 'Body stays', metadataFor('FW'));
        await updateNote(deps, { id: 'nw', title: 'Renamed' });
        expect(markdownOf(uploads[0].yjsBlob)).toBe('Body stays');
        expect(uploads[0].metadata.title).toBe('Renamed');
        expect(uploads[0].metadata.tags).toEqual(['work']);
    });

    it('a title-only update retries after a conflict and keeps the human edit', async () => {
        const { deps, put, store, uploads } = makeDrive({
            beforeUpload: (s, attempt) => {
                if (attempt === 1) humanAppends(s, 'nw', 'Human line');
            },
        });
        put('nw', 'Body', metadataFor('FW'));
        await updateNote(deps, { id: 'nw', title: 'Renamed' });
        expect(uploads).toHaveLength(2);
        expect(store.get('nw')!.metadata.title).toBe('Renamed');
        expect(markdownOf(store.get('nw')!.blob)).toBe('Body\n\nHuman line');
    });

    it('the rewrite merges with a human edit that lands meanwhile', async () => {
        const { deps, put, store } = makeDrive({
            beforeUpload: (s, attempt) => {
                if (attempt === 1) humanAppends(s, 'nw', 'Human line');
            },
        });
        put('nw', 'Keep me\n\nOld', metadataFor('FW'));
        await updateNote(deps, { id: 'nw', markdown: 'Keep me\n\nNew' });
        const final = markdownOf(store.get('nw')!.blob);
        expect(final).toContain('New');
        expect(final).toContain('Human line');
        expect(final).not.toContain('Old');
    });

    it('accepts a matching expectedModified, in any ISO form', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nw', 'Body', metadataFor('FW'));
        await updateNote(deps, { id: 'nw', markdown: 'New', expectedModified: '2024-01-02T00:00:00Z' });
        expect(uploads).toHaveLength(1);
    });

    it('rejects a stale expectedModified and leaves the note unchanged', async () => {
        const { deps, put, store, uploads } = makeDrive();
        put('nw', 'Body', metadataFor('FW'));
        const before = store.get('nw')!;
        await expect(
            updateNote(deps, { id: 'nw', markdown: 'New', title: 'X', expectedModified: '2024-01-01T00:00:00.000Z' })
        ).rejects.toThrow('Note changed since 2024-01-01T00:00:00.000Z (now 2024-01-02T00:00:00.000Z); get_note it again: nw');
        expect(uploads).toHaveLength(0);
        expect(store.get('nw')).toBe(before);
    });

    it('rejects read-only and ungranted notes, and an empty update', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nr', 'Readable', metadataFor('FR'));
        put('nn', 'Hidden', metadataFor('FN'));
        put('nw', 'Body', metadataFor('FW'));
        await expect(updateNote(deps, { id: 'nr', markdown: 'x' })).rejects.toThrow('Note is read-only for agents: nr');
        await expect(updateNote(deps, { id: 'nn', markdown: 'x' })).rejects.toThrow('Note not found: nn');
        await expect(updateNote(deps, { id: 'nw' })).rejects.toThrow('update_note: give markdown, title or tags');
        expect(uploads).toHaveLength(0);
    });
});

describe('write tools: delete_note (#511)', () => {
    it('moves a writable note to Trash and returns its state', async () => {
        const { deps, put, trashed, uploads } = makeDrive();
        put('nw', 'Body', metadataFor('FW'));
        await expect(deleteNote(deps, { id: 'nw' })).resolves.toEqual({ id: 'nw', state: 'trashed' });
        expect(trashed).toEqual([{ id: 'nw', fileId: 'file-nw' }]);
        expect(uploads).toHaveLength(0);
        // A trashed note is gone for agents.
        await expect(deleteNote(deps, { id: 'nw' })).rejects.toThrow('Note not found: nw');
    });

    it('rejects read-only, ungranted and excludeFromAI notes without trashing', async () => {
        const { deps, put, trashed } = makeDrive();
        put('nr', 'Readable', metadataFor('FR'));
        put('nn', 'Hidden', metadataFor('FN'));
        put('nx', 'Private', metadataFor('FW', { excludeFromAI: true }));
        await expect(deleteNote(deps, { id: 'nr' })).rejects.toThrow('Note is read-only for agents: nr');
        await expect(deleteNote(deps, { id: 'nn' })).rejects.toThrow('Note not found: nn');
        await expect(deleteNote(deps, { id: 'nx' })).rejects.toThrow('Note not found: nx');
        expect(trashed).toHaveLength(0);
    });
});

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/images/${name}`, import.meta.url));
const dataUri = (bytes: Uint8Array, type = 'image/png') => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

/** A doc with a light cover at jrnl_img0 and a dark one at jrnl_img1, as the app leaves it. */
function withCovers(doc: Y.Doc) {
    setCover(doc, { src: 'attachment://file-nw/jrnl_img0', positionY: 20 });
    setDarkCover(doc, { src: 'attachment://file-nw/jrnl_img1', positionY: 70 });
    advanceNextImageIndex(doc, 'jrnl_img1');
}

describe('write tools: set_note_cover / clear_note_cover (#516)', () => {
    it('sets the cover from a file path, uploading the JPEG with its EXIF stripped', async () => {
        const { deps, put, store, images, uploads } = makeDrive({ clientName: 'claude-code' });
        put('nw', 'Body', metadataFor('FW'));
        expect(readFileSync(fixturePath('cover-exif.jpg')).includes('Exif')).toBe(true);

        const result = await setNoteCover(deps, { id: 'nw', image: fixturePath('cover-exif.jpg') });
        expect(result).toEqual({ id: 'nw', variant: 'light', src: 'attachment://file-nw/jrnl_img0', positionY: 50 });

        expect(images).toHaveLength(1);
        const uploaded = images[0].image;
        expect(uploaded).toMatchObject({ contentType: 'image/jpeg', width: 40, height: 24 });
        expect(Buffer.from(uploaded.bytes).includes('Exif')).toBe(false);
        expect(Buffer.from(uploaded.bytes).includes(Buffer.from([0xff, 0xe1]))).toBe(false);

        const blob = store.get('nw')!.blob;
        expect(getCoverFromBlob(blob)).toEqual({ src: 'attachment://file-nw/jrnl_img0', positionY: 50 });
        expect(uploads).toHaveLength(1);
        expect(uploads[0].metadata.lastEditedBy).toBe('agent:claude-code');
        expect(uploads[0].toDeletePayloads).toBeUndefined();
        // The note's key counter moves past the new key, as the app's upload does.
        const doc = new Y.Doc();
        Y.applyUpdate(doc, blob);
        expect(readNextImageIndex(doc)).toBe(1);
        expect(markdownOf(blob).trim()).toBe('Body');
    });

    it('sets the cover from a data: URI with a focal point', async () => {
        const { deps, put, store, images } = makeDrive();
        put('nw', 'Body', metadataFor('FW'));
        const png = new Uint8Array(readFileSync(fixturePath('cover-meta.png')));
        const result = await setNoteCover(deps, { id: 'nw', image: dataUri(png), positionY: 30 });
        expect(result).toMatchObject({ src: 'attachment://file-nw/jrnl_img0', positionY: 30 });
        expect(images[0].image.contentType).toBe('image/png');
        expect(Buffer.from(images[0].image.bytes).includes('SECRET')).toBe(false);
        expect(getCoverFromBlob(store.get('nw')!.blob)).toEqual({ src: 'attachment://file-nw/jrnl_img0', positionY: 30 });
    });

    it('replacing the light cover keeps the dark one and deletes the old payload', async () => {
        const { deps, putDoc, store, uploads } = makeDrive();
        putDoc('nw', withCovers, metadataFor('FW'));
        await setNoteCover(deps, { id: 'nw', image: fixturePath('cover-plain.webp') });
        expect(getCoverFromBlob(store.get('nw')!.blob)).toEqual({
            src: 'attachment://file-nw/jrnl_img2',
            positionY: 50,
            dark: { src: 'attachment://file-nw/jrnl_img1', positionY: 70 },
        });
        expect(uploads.at(-1)!.toDeletePayloads).toEqual(['jrnl_img0']);
    });

    it('sets the dark cover next to the light one, and refuses it without a light cover', async () => {
        const { deps, put, putDoc, store, images, uploads } = makeDrive();
        putDoc('nw', withCovers, metadataFor('FW'));
        const result = await setNoteCover(deps, { id: 'nw', image: fixturePath('cover-lossless.webp'), dark: true, positionY: 10 });
        expect(result).toMatchObject({ variant: 'dark', src: 'attachment://file-nw/jrnl_img2', positionY: 10 });
        expect(getCoverFromBlob(store.get('nw')!.blob)).toEqual({
            src: 'attachment://file-nw/jrnl_img0',
            positionY: 20,
            dark: { src: 'attachment://file-nw/jrnl_img2', positionY: 10 },
        });
        expect(uploads.at(-1)!.toDeletePayloads).toEqual(['jrnl_img1']);

        put('bare', 'Body', metadataFor('FW'));
        images.length = 0;
        await expect(setNoteCover(deps, { id: 'bare', image: fixturePath('cover-plain.webp'), dark: true })).rejects.toThrow(
            'Note has no cover; set the light cover before the dark one: bare'
        );
        expect(images).toHaveLength(0);
    });

    it('never deletes a payload the body still shows', async () => {
        const { deps, putDoc, uploads } = makeDrive();
        putDoc(
            'nw',
            (doc) => {
                withCovers(doc);
                const image = new Y.XmlElement('image');
                image.setAttribute('src', 'attachment://file-nw/jrnl_img0');
                doc.getXmlFragment('prosemirror').push([image]);
            },
            metadataFor('FW')
        );
        await setNoteCover(deps, { id: 'nw', image: fixturePath('cover-plain.webp') });
        expect(uploads.at(-1)!.toDeletePayloads).toBeUndefined();
    });

    it('rejects a bad type, an image over 5 MB and a read-only grant with clear messages, uploading nothing', async () => {
        const { deps, put, images, uploads } = makeDrive();
        put('nw', 'Body', metadataFor('FW'));
        put('nr', 'Readable', metadataFor('FR'));
        put('nn', 'Hidden', metadataFor('FN'));

        const gif = new TextEncoder().encode('GIF89a\x01\x00\x01\x00');
        await expect(setNoteCover(deps, { id: 'nw', image: dataUri(gif, 'image/gif') })).rejects.toThrow(
            'Unsupported image type: use a PNG, JPEG or WebP image'
        );
        const huge = new Uint8Array(5 * 1024 * 1024 + 1);
        huge.set(readFileSync(fixturePath('cover-meta.png')));
        await expect(setNoteCover(deps, { id: 'nw', image: dataUri(huge) })).rejects.toThrow(
            'Image is too large (5.0 MB); the limit is 5 MB'
        );
        const dir = mkdtempSync(join(tmpdir(), 'cover-'));
        try {
            writeFileSync(join(dir, 'huge.png'), huge);
            await expect(setNoteCover(deps, { id: 'nw', image: join(dir, 'huge.png') })).rejects.toThrow('the limit is 5 MB');
        } finally {
            rmSync(dir, { recursive: true });
        }
        await expect(setNoteCover(deps, { id: 'nw', image: '/no/such/cover.png' })).rejects.toThrow(
            'Image file not found: /no/such/cover.png'
        );
        await expect(setNoteCover(deps, { id: 'nw', image: 'data:image/png,%89PNG' })).rejects.toThrow('must be base64-encoded');
        await expect(setNoteCover(deps, { id: 'nr', image: fixturePath('cover-exif.jpg') })).rejects.toThrow(
            'Note is read-only for agents: nr'
        );
        await expect(setNoteCover(deps, { id: 'nn', image: fixturePath('cover-exif.jpg') })).rejects.toThrow('Note not found: nn');
        await expect(clearNoteCover(deps, { id: 'nr' })).rejects.toThrow('Note is read-only for agents: nr');
        expect(images).toHaveLength(0);
        expect(uploads).toHaveLength(0);
    });

    it('says the link card is not redrawn when setting the light cover of a public note', async () => {
        const { deps, put, putDoc } = makeDrive();
        put('np', 'Body', metadataFor('FW', { isPublic: true }));
        const light = await setNoteCover(deps, { id: 'np', image: fixturePath('cover-plain.webp') });
        expect(light.note).toMatch(/public.*link-preview card image can't be drawn here/);

        putDoc('npd', withCovers, metadataFor('FW', { isPublic: true }));
        const dark = await setNoteCover(deps, { id: 'npd', image: fixturePath('cover-plain.webp'), dark: true });
        expect(dark.note).toBeUndefined();
    });

    it('clear_note_cover removes the cover with its dark one and deletes both payloads', async () => {
        const { deps, putDoc, store, uploads } = makeDrive();
        putDoc('nw', withCovers, metadataFor('FW'));
        await expect(clearNoteCover(deps, { id: 'nw' })).resolves.toEqual({ id: 'nw', variant: 'light', cleared: true });
        expect(getCoverFromBlob(store.get('nw')!.blob)).toBeNull();
        expect(uploads.at(-1)!.toDeletePayloads).toEqual(['jrnl_img0', 'jrnl_img1']);
    });

    it('clear_note_cover with dark removes only the dark cover', async () => {
        const { deps, putDoc, store, uploads } = makeDrive();
        putDoc('nw', withCovers, metadataFor('FW'));
        await expect(clearNoteCover(deps, { id: 'nw', dark: true })).resolves.toEqual({ id: 'nw', variant: 'dark', cleared: true });
        expect(getCoverFromBlob(store.get('nw')!.blob)).toEqual({ src: 'attachment://file-nw/jrnl_img0', positionY: 20 });
        expect(uploads.at(-1)!.toDeletePayloads).toEqual(['jrnl_img1']);
    });

    it('clear_note_cover on a note without a cover changes nothing', async () => {
        const { deps, put, uploads } = makeDrive();
        put('nw', 'Body', metadataFor('FW'));
        await expect(clearNoteCover(deps, { id: 'nw' })).resolves.toEqual({ id: 'nw', variant: 'light', cleared: false });
        expect(uploads).toHaveLength(0);
    });
});
