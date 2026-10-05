// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { syncRecord, syncNote, makeNotePublic, mutate } = vi.hoisted(() => ({
    syncRecord: { current: undefined as { remoteFileId?: string } | undefined },
    syncNote: vi.fn(async () => {}),
    makeNotePublic: vi.fn(async () => ({ versionTag: 'v2', previousVersionTag: 'v1' })),
    mutate: vi.fn(),
}));

vi.mock('@/hooks/auth', () => ({ useAuth: () => ({ getIdentity: () => 'frodo.dotyou.cloud' }) }));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({}) }));
vi.mock('@/hooks/useNotes', () => ({
    useNotes: () => ({ get: { data: [] }, setNotePublic: { mutate }, setShareCard: {} }),
}));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ syncNote }) }));
vi.mock('@/hooks/useShareCardPreview', () => ({ useShareCardPreview: () => ({}) }));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class { makeNotePublic = makeNotePublic; },
}));
vi.mock('@/lib/db', () => ({
    getSyncRecord: vi.fn(async () => syncRecord.current),
    getDocumentUpdates: vi.fn(async () => []),
}));
vi.mock('@/lib/yjs-utils', () => ({ extractMarkdownFromYjs: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ShareDialog from '@/components/modals/ShareDialog';

const NOTE_ID = 'note-1';

describe('ShareDialog make public', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        host.remove();
    });

    async function clickMakePublic() {
        await act(async () => {
            root.render(createElement(ShareDialog, { isOpen: true, onClose: () => {}, noteId: NOTE_ID, noteTitle: 'T' }));
        });
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Make Note Public'));
        await act(async () => { button?.click(); });
    }

    it('pushes a not-yet-uploaded note first and publishes it by its new fileId', async () => {
        syncRecord.current = { remoteFileId: undefined };
        syncNote.mockImplementation(async () => { syncRecord.current = { remoteFileId: 'file-1' }; });

        await clickMakePublic();

        expect(syncNote).toHaveBeenCalledWith(NOTE_ID);
        expect(makeNotePublic).toHaveBeenCalledWith(NOTE_ID, 'file-1', expect.anything());
        expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ docId: NOTE_ID, isPublic: true }));
    });

    it('does not push again when the note is already on the server', async () => {
        syncRecord.current = { remoteFileId: 'file-1' };

        await clickMakePublic();

        expect(syncNote).not.toHaveBeenCalled();
        expect(makeNotePublic).toHaveBeenCalledWith(NOTE_ID, 'file-1', expect.anything());
    });
});
