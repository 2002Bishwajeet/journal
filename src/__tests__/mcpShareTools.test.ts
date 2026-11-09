import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createDoc } from '@/lib/agent/editEngine';
import { getSharing, shareNote } from '@/lib/agent/tools/share';
import type { WriteDeps } from '@/lib/agent/tools/write';
import type { AgentGrants } from '@/lib/agent/grants';
import type { DocumentMetadata } from '@/types';

const OWNER = 'owner.dotyou.cloud';

function metadataFor(folderId: string, overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
    return {
        title: 'Plan',
        folderId,
        timestamps: { created: '2024-01-01T00:00:00.000Z', modified: '2024-01-02T00:00:00.000Z' },
        excludeFromAI: false,
        ...overrides,
    };
}

/** A fake drive: FW writable, FR read-only, FS writable and shared (public). */
function makeDrive(grants: Partial<AgentGrants> = { allowShareRequests: true }) {
    const store = new Map<string, DocumentMetadata>();
    const uploads: { id: string; metadata: DocumentMetadata }[] = [];
    const visibility: { id: string; isPublic: boolean }[] = [];
    const deps = {
        loadGrants: async () => ({ version: 1, folders: { FW: 'write', FR: 'read', FS: 'write' }, notes: {}, ...grants }),
        listFolders: async () => [
            { id: 'FW', name: 'Work' },
            { id: 'FR', name: 'Read' },
            { id: 'FS', name: 'Blog', isPublic: true },
        ],
        fetchNoteForEdit: async (id: string) => {
            const metadata = store.get(id);
            if (!metadata) return null;
            const doc = new Y.Doc();
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(createDoc('Body')));
            return {
                summary: { id, title: metadata.title, folderId: metadata.folderId, tags: [], modified: metadata.timestamps.modified, excludeFromAI: metadata.excludeFromAI },
                doc,
                versionTag: '1',
                fileId: `file-${id}`,
                metadata: structuredClone(metadata),
            };
        },
        uploadNoteEdit: async (id: string, edit: { metadata: DocumentMetadata }) => {
            uploads.push({ id, metadata: edit.metadata });
            store.set(id, JSON.parse(JSON.stringify(edit.metadata)));
            return edit.metadata.timestamps.modified;
        },
        setNotePublic: async (id: string, _fileId: string, isPublic: boolean) => {
            visibility.push({ id, isPublic });
            store.set(id, { ...store.get(id)!, isPublic });
            return '';
        },
        clientName: () => 'claude-code',
        ownerIdentity: () => OWNER,
        shareLink: (id: string) => `https://journal.test/share/${OWNER}/${id}`,
    } as unknown as WriteDeps;
    return { deps, store, uploads, visibility };
}

const sharedWithFriend = { isCollaborative: true, odinIds: ['friend.dotyou.cloud'] };

describe('share_note', () => {
    it('asks to make a private note public: a pending request, nothing published', async () => {
        const { deps, store, uploads, visibility } = makeDrive();
        store.set('n', metadataFor('FW'));
        const result = await shareNote(deps, { id: 'n', access: 'public' });
        expect(result).toMatchObject({ status: 'pending', access: 'public', link: `https://journal.test/share/${OWNER}/n` });
        expect(result.note).toContain('until the owner confirms');
        expect(visibility).toEqual([]);
        expect(uploads[0].metadata.shareRequest).toMatchObject({ access: 'public', by: 'agent:claude-code' });
        expect(uploads[0].metadata.isPublic).toBeUndefined();
    });

    it('a newer request replaces the older one', async () => {
        const { deps, store } = makeDrive();
        store.set('n', metadataFor('FW'));
        await shareNote(deps, { id: 'n', access: 'public' });
        await shareNote(deps, { id: 'n', access: 'people', with: [{ kind: 'circle', id: 'Family' }] });
        expect(store.get('n')!.shareRequest).toMatchObject({
            access: 'people',
            with: [{ kind: 'circle', id: 'Family', role: 'viewer' }],
        });
    });

    it('people: identities are normalized, and the role defaults to viewer', async () => {
        const { deps, store } = makeDrive();
        store.set('n', metadataFor('FW'));
        const result = await shareNote(deps, {
            id: 'n',
            access: 'people',
            with: [{ kind: 'person', id: 'https://Friend.DotYou.Cloud/' }, { kind: 'circle', id: 'c1', role: 'editor' }],
        });
        expect(result.with).toEqual([
            { kind: 'person', id: 'friend.dotyou.cloud', role: 'viewer' },
            { kind: 'circle', id: 'c1', role: 'editor' },
        ]);
    });

    it('the same target as now is unchanged: no write', async () => {
        const { deps, store, uploads, visibility } = makeDrive();
        store.set('pub', metadataFor('FW', { isPublic: true }));
        store.set('ppl', metadataFor('FW', sharedWithFriend));
        store.set('priv', metadataFor('FW'));
        expect((await shareNote(deps, { id: 'pub', access: 'public' })).status).toBe('unchanged');
        expect((await shareNote(deps, { id: 'ppl', access: 'people', with: [{ kind: 'person', id: 'friend.dotyou.cloud' }] })).status).toBe('unchanged');
        expect((await shareNote(deps, { id: 'priv', access: 'private' })).status).toBe('unchanged');
        expect(uploads).toEqual([]);
        expect(visibility).toEqual([]);
    });

    it('private on a private note clears a pending request', async () => {
        const { deps, store } = makeDrive();
        store.set('n', metadataFor('FW'));
        await shareNote(deps, { id: 'n', access: 'public' });
        expect((await shareNote(deps, { id: 'n', access: 'private' })).status).toBe('unchanged');
        expect(store.get('n')!.shareRequest).toBeUndefined();
    });

    it('with the switch off, widening is refused but public to private is applied', async () => {
        const { deps, store, uploads, visibility } = makeDrive({});
        store.set('priv', metadataFor('FW'));
        store.set('pub', metadataFor('FW', { isPublic: true }));
        await expect(shareNote(deps, { id: 'priv', access: 'public' })).rejects.toThrow(/Let agents ask to share notes/);
        const result = await shareNote(deps, { id: 'pub', access: 'private' });
        expect(result).toMatchObject({ status: 'shared', access: 'private' });
        expect(result.link).toBeUndefined();
        expect(visibility).toEqual([{ id: 'pub', isPublic: false }]);
        expect(uploads).toEqual([]);
    });

    it('stopping a people share is a request too', async () => {
        const { deps, store } = makeDrive();
        store.set('n', metadataFor('FW', sharedWithFriend));
        expect((await shareNote(deps, { id: 'n', access: 'private' })).status).toBe('pending');
        expect(store.get('n')!.shareRequest).toMatchObject({ access: 'private' });
    });

    it('public on a note shared with people says they would lose access', async () => {
        const { deps, store } = makeDrive();
        store.set('n', metadataFor('FW', sharedWithFriend));
        expect((await shareNote(deps, { id: 'n', access: 'public' })).note).toContain('lose access');
    });

    it('people on a public note is refused: the request would be world-readable', async () => {
        const { deps, store, uploads } = makeDrive();
        store.set('n', metadataFor('FW', { isPublic: true }));
        await expect(shareNote(deps, { id: 'n', access: 'people', with: [{ kind: 'circle', id: 'c1' }] })).rejects.toThrow(/Make it private first/);
        expect(uploads).toEqual([]);
    });

    it.each([
        ['a person as editor', [{ kind: 'person' as const, id: 'friend.dotyou.cloud', role: 'editor' as const }], /only be a viewer/],
        ["the owner's own identity", [{ kind: 'person' as const, id: OWNER.toUpperCase() }], /owner/],
        ['an invalid identity', [{ kind: 'person' as const, id: 'not an identity' }], /not a Homebase identity/],
        ['an empty set', [], /at least one/],
        ['an empty circle', [{ kind: 'circle' as const, id: '  ' }], /circle needs/],
    ])('refuses %s', async (_label, entries, error) => {
        const { deps, store, uploads } = makeDrive();
        store.set('n', metadataFor('FW'));
        await expect(shareNote(deps, { id: 'n', access: 'people', with: entries })).rejects.toThrow(error);
        expect(uploads).toEqual([]);
    });

    it('refuses `with` for anything but people', async () => {
        const { deps, store } = makeDrive();
        store.set('n', metadataFor('FW'));
        await expect(shareNote(deps, { id: 'n', access: 'public', with: [] })).rejects.toThrow(/only for access "people"/);
    });

    it("refuses someone else's note, a read-only note and a hidden note", async () => {
        const { deps, store } = makeDrive();
        store.set('theirs', metadataFor('FW', { authorOdinId: 'friend.dotyou.cloud' }));
        store.set('ro', metadataFor('FR'));
        store.set('hidden', metadataFor('FW', { excludeFromAI: true }));
        await expect(shareNote(deps, { id: 'theirs', access: 'public' })).rejects.toThrow(/only the owner/);
        await expect(shareNote(deps, { id: 'ro', access: 'public' })).rejects.toThrow(/read-only/);
        await expect(shareNote(deps, { id: 'hidden', access: 'public' })).rejects.toThrow(/not found/);
    });

    it('a note in a shared folder points at update_note folderId', async () => {
        const { deps, store } = makeDrive();
        store.set('n', metadataFor('FS', { isPublic: true }));
        await expect(shareNote(deps, { id: 'n', access: 'private' })).rejects.toThrow(/shared folder Blog.*update_note folderId/);
    });
});

describe('get_sharing', () => {
    it('maps public, people and circles, and a pending request', async () => {
        const { deps, store } = makeDrive();
        store.set('pub', metadataFor('FS', { isPublic: true }));
        store.set('ppl', metadataFor('FR', { isCollaborative: true, circleIds: ['c1'], viewerCircleIds: ['c2'], odinIds: ['friend.dotyou.cloud'] }));
        store.set('priv', metadataFor('FW', { shareRequest: { access: 'public', by: 'agent:claude-code', at: Date.UTC(2026, 10, 9) } }));

        expect(await getSharing(deps, { id: 'pub' })).toEqual({
            id: 'pub',
            access: 'public',
            link: `https://journal.test/share/${OWNER}/pub`,
            with: [],
            inSharedFolder: true,
        });
        expect(await getSharing(deps, { id: 'ppl' })).toMatchObject({
            access: 'people',
            inSharedFolder: false,
            with: [
                { kind: 'circle', id: 'c1', role: 'editor' },
                { kind: 'circle', id: 'c2', role: 'viewer' },
                { kind: 'person', id: 'friend.dotyou.cloud', role: 'viewer' },
            ],
        });
        const priv = await getSharing(deps, { id: 'priv' });
        expect(priv.link).toBeUndefined();
        expect(priv.pending).toEqual({ access: 'public', by: 'agent:claude-code', at: '2026-11-09T00:00:00.000Z' });
    });

    it('a note the agent has no access to is not found', async () => {
        const { deps, store } = makeDrive();
        store.set('n', metadataFor('FN'));
        await expect(getSharing(deps, { id: 'n' })).rejects.toThrow(/not found/);
    });
});
