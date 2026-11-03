/**
 * The owner's own invite file sits on the owner's drive too. The owner's pull
 * must not treat it as an incoming share (#680).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    upsertSearchIndex: vi.fn(),
    saveDocumentUpdate: vi.fn(),
    upsertSyncRecord: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
    upsertSearchIndex: mocks.upsertSearchIndex,
    deleteSearchIndexEntry: vi.fn(),
    getDocumentUpdates: vi.fn(),
    saveDocumentUpdate: mocks.saveDocumentUpdate,
    deleteDocumentUpdates: vi.fn(),
    replaceDocumentUpdates: vi.fn(),
    getSyncRecord: vi.fn(),
    upsertSyncRecord: mocks.upsertSyncRecord,
    deleteSyncRecord: vi.fn(),
    getAppState: vi.fn(async () => null),
    saveAppState: vi.fn(),
}));

import { handleInvitation } from '@/lib/homebase/sync/peerNotes';
import type { SyncContext } from '@/lib/homebase/sync/context';
import type { HomebaseFile } from '@homebase-id/js-lib/core';

const fileFrom = (senderOdinId?: string) =>
    ({ fileId: 'f', fileMetadata: { senderOdinId } }) as unknown as HomebaseFile<string>;

const HOST = 'sam.dotyou.cloud';

function ctxWithInviteFrom(authorOdinId: string) {
    return {
        hostIdentity: HOST,
        notesProvider: {
            dsrToContent: vi.fn(async () => ({
                authorOdinId,
                noteUniqueId: 'note-1',
                noteTitle: 'Title',
                notePreview: 'p',
                sharedAt: '2026-01-01T00:00:00.000Z',
            })),
            // Peer fetch fails, so a real share writes the placeholder search-index row
            getNote: vi.fn(async () => { throw new Error('offline'); }),
        },
    } as unknown as SyncContext;
}

beforeEach(() => vi.clearAllMocks());

describe('handleInvitation', () => {
    it('writes nothing for an invite the host authored', async () => {
        await handleInvitation(ctxWithInviteFrom(HOST), fileFrom(HOST));

        expect(mocks.upsertSearchIndex).not.toHaveBeenCalled();
        expect(mocks.saveDocumentUpdate).not.toHaveBeenCalled();
        expect(mocks.upsertSyncRecord).not.toHaveBeenCalled();
    });

    it('still bootstraps an invite from someone else', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await handleInvitation(ctxWithInviteFrom('frodo.dotyou.cloud'), fileFrom('frodo.dotyou.cloud'));

        expect(mocks.upsertSearchIndex).toHaveBeenCalledTimes(1);
    });

    it('ignores an invite whose sender differs from the claimed author', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = ctxWithInviteFrom('frodo.dotyou.cloud');
        await handleInvitation(ctx, fileFrom('sauron.dotyou.cloud'));

        expect(warn).toHaveBeenCalled();
        expect(ctx.notesProvider.getNote).not.toHaveBeenCalled();
        expect(mocks.upsertSearchIndex).not.toHaveBeenCalled();
    });

    it('ignores an invite with no sender', async () => {
        const ctx = ctxWithInviteFrom('frodo.dotyou.cloud');
        await handleInvitation(ctx, fileFrom(undefined));

        expect(ctx.notesProvider.getNote).not.toHaveBeenCalled();
        expect(mocks.upsertSearchIndex).not.toHaveBeenCalled();
    });

    it('fetches the note from the sender', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = ctxWithInviteFrom('frodo.dotyou.cloud');
        await handleInvitation(ctx, fileFrom('frodo.dotyou.cloud'));

        expect(ctx.notesProvider.getNote).toHaveBeenCalledWith('note-1', 'frodo.dotyou.cloud', { decrypt: true });
    });
});
