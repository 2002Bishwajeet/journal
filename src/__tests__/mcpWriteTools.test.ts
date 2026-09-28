import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { appendToNote, replaceInNote, createNote, VersionConflictError, type WriteDeps } from '../../mcp/tools/write';
import type { NoteSummary } from '../../mcp/tools/read';
import type { AgentGrants } from '@/lib/agent/grants';
import type { DocumentMetadata } from '@/types';
import { createDoc, appendMarkdown, toMarkdown } from '@/lib/agent/editEngine';

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
        clientName: () => opts.clientName ?? '',
    };

    return { deps, store, uploads, creates, put };
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
