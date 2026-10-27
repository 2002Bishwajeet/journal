// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { syncRecord, syncNote, makeNotePublic, mutate, mutateAsync, notes, access } = vi.hoisted(() => ({
    syncRecord: { current: undefined as { remoteFileId?: string } | undefined },
    syncNote: vi.fn(async () => {}),
    makeNotePublic: vi.fn(async () => ({ versionTag: 'v2', previousVersionTag: 'v1' })),
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => {}),
    notes: { current: [] as { docId: string; metadata: { shareIndexable?: boolean; isPublic?: boolean } }[] },
    // The people part's state, as useShareAccess hands it to the dialog
    access: { current: {} as Record<string, unknown> },
}));

vi.mock('@/hooks/auth', () => ({ useAuth: () => ({ getIdentity: () => 'frodo.dotyou.cloud' }) }));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({}) }));
vi.mock('@/hooks/useNotes', () => ({
    useNotes: () => ({ get: { data: notes.current }, setNotePublic: { mutate }, setShareCard: { mutateAsync } }),
}));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ syncNote }) }));
vi.mock('@/hooks/useShareCardPreview', () => ({ useShareCardPreview: () => ({}) }));
vi.mock('@/hooks/useShareAccess', () => ({
    useShareAccess: () => ({ ...access.current, note: notes.current.find((n) => n.docId === NOTE_ID) }),
}));
vi.mock('@/hooks/useSheetMode', () => ({ useSheetMode: () => false }));
vi.mock('@/hooks/auth/useMissingPermissions', () => ({ useMissingPermissions: () => undefined }));
vi.mock('@/hooks/auth/useYouAuthAuthorization', () => ({ journalDriveRequest: {} }));
vi.mock('@/hooks/useContact', () => ({ useContact: () => ({ fetch: { data: undefined } }) }));
vi.mock('@/components/author/AuthorImage', () => ({ AuthorImage: () => null }));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class { makeNotePublic = makeNotePublic; },
}));
vi.mock('@/lib/db', () => ({
    getSyncRecord: vi.fn(async () => syncRecord.current),
    getDocumentUpdates: vi.fn(async () => []),
}));
vi.mock('@/lib/yjs-utils', () => ({ extractMarkdownFromYjs: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import ShareNoteDialog from '@/components/modals/ShareNoteDialog';

const NOTE_ID = 'note-1';
const DRIVE_URL = 'https://me.id/owner/apps/console/drives/alias_type';

const buttons = (label: string) => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

function idleAccess(overrides: Record<string, unknown> = {}) {
    return {
        owner: 'frodo.dotyou.cloud',
        entries: [],
        isShared: false,
        isDirty: false,
        isSaving: false,
        circles: [],
        circleName: (id: string) => id,
        query: '',
        setQuery: vi.fn(),
        candidates: [],
        setActiveIndex: vi.fn(),
        refusal: null,
        role: 'viewer',
        setPickedRole: vi.fn(),
        add: vi.fn(),
        setRole: vi.fn(),
        remove: vi.fn(),
        save: vi.fn(async () => ({ shared: true })),
        stopSharing: vi.fn(async () => true),
        ...overrides,
    };
}

describe('ShareNoteDialog', () => {
    let host: HTMLDivElement;
    let root: Root;
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        notes.current = [];
        access.current = idleAccess();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        host.remove();
    });

    async function open(props: Record<string, unknown> = {}) {
        await act(async () => {
            root.render(createElement(ShareNoteDialog, { isOpen: true, onClose, noteId: NOTE_ID, noteTitle: 'T', ...props }));
        });
    }

    async function clickMakePublic() {
        await open();
        await act(async () => { button('Make Note Public')?.click(); });
    }

    describe('make public', () => {
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

        it('publishes a new note as indexable and persists the flag', async () => {
            syncRecord.current = { remoteFileId: 'file-1' };
            notes.current = [{ docId: NOTE_ID, metadata: {} }];

            await clickMakePublic();

            expect(makeNotePublic).toHaveBeenCalledWith(NOTE_ID, 'file-1', expect.objectContaining({ indexable: true }));
            expect(mutateAsync).toHaveBeenCalledWith({ docId: NOTE_ID, shareIndexable: true });
        });

        it('keeps a stored opt-out when republishing', async () => {
            syncRecord.current = { remoteFileId: 'file-1' };
            notes.current = [{ docId: NOTE_ID, metadata: { shareIndexable: false } }];

            await clickMakePublic();

            expect((makeNotePublic.mock.calls as unknown[][])[0][2]).not.toHaveProperty('indexable');
            expect(mutateAsync).not.toHaveBeenCalled();
        });

        it('asks once before making a note shared with people public, and stops sharing first', async () => {
            syncRecord.current = { remoteFileId: 'file-1' };
            access.current = idleAccess({ isShared: true });

            await clickMakePublic();
            expect(makeNotePublic).not.toHaveBeenCalled();
            expect(document.body.textContent).toContain('Make the note public?');

            await act(async () => { buttons('Make public')[0]?.click(); });
            expect(access.current.stopSharing).toHaveBeenCalledTimes(1);
            expect(makeNotePublic).toHaveBeenCalledWith(NOTE_ID, 'file-1', expect.anything());
        });

        it('stays restricted when stopping the people share failed', async () => {
            access.current = idleAccess({ isShared: true, stopSharing: vi.fn(async () => false) });

            await clickMakePublic();
            await act(async () => { buttons('Make public')[0]?.click(); });

            expect(makeNotePublic).not.toHaveBeenCalled();
        });
    });

    describe('private linked notes', () => {
        beforeEach(() => {
            syncRecord.current = { remoteFileId: 'file-1' };
            notes.current = [
                { docId: NOTE_ID, title: 'A', metadata: { shareIndexable: true, linkedNoteIds: ['b', 'c'] } },
                { docId: 'b', title: 'Private B', metadata: { shareIndexable: true } },
                { docId: 'c', title: 'Public C', metadata: { shareIndexable: true, isPublic: true } },
            ] as never;
        });

        it('asks first and lists only the private linked notes', async () => {
            await clickMakePublic();

            expect(makeNotePublic).not.toHaveBeenCalled();
            expect(document.body.textContent).toContain('links to 1 private note');
            expect(document.body.textContent).toContain('Private B');
            expect(document.body.textContent).not.toContain('Public C');
        });

        it('makes the note and the listed notes public with one toast', async () => {
            await clickMakePublic();
            await act(async () => { button('Make these public too')?.click(); });

            expect(makeNotePublic.mock.calls.map((c) => (c as unknown[])[0])).toEqual([NOTE_ID, 'b']);
            expect(toast.success).toHaveBeenCalledTimes(1);
        });

        it('makes only the note public on Continue anyway', async () => {
            await clickMakePublic();
            await act(async () => { button('Continue anyway')?.click(); });

            expect(makeNotePublic.mock.calls.map((c) => (c as unknown[])[0])).toEqual([NOTE_ID]);
        });
    });

    describe('people', () => {
        const PERSON = { kind: 'person', id: 'sam.id', role: 'viewer' };

        it('saves the changes on Done and closes', async () => {
            access.current = idleAccess({ isDirty: true, entries: [PERSON] });
            await open();

            await act(async () => { buttons('Done')[0]?.click(); });

            expect(access.current.save).toHaveBeenCalledTimes(1);
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('stays open when the save failed', async () => {
            access.current = idleAccess({ isDirty: true, entries: [PERSON], save: vi.fn(async () => ({ shared: false })) });
            await open();

            await act(async () => { buttons('Done')[0]?.click(); });

            expect(onClose).not.toHaveBeenCalled();
        });

        it('stays open with the read-only notice and the drive settings link', async () => {
            access.current = idleAccess({
                isDirty: true,
                entries: [PERSON],
                save: vi.fn(async () => ({ shared: true, readOnlyDriveUrl: DRIVE_URL })),
            });
            await open();

            await act(async () => { buttons('Done')[0]?.click(); });

            expect(onClose).not.toHaveBeenCalled();
            expect(document.body.textContent).toContain("People you share with can read this note but can't edit it yet.");
            const link = document.querySelector<HTMLAnchorElement>('a[aria-label^="Open drive settings"]');
            expect(link?.href).toBe(DRIVE_URL);
            await act(async () => { buttons('Done')[0]?.click(); });
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('asks once before sharing a public note with people', async () => {
            notes.current = [{ docId: NOTE_ID, metadata: { isPublic: true } }];
            access.current = idleAccess({ isDirty: true, entries: [PERSON] });
            await open();
            expect(document.body.textContent).toContain('Sharing with people turns it off');

            await act(async () => { buttons('Done')[0]?.click(); });
            expect(access.current.save).not.toHaveBeenCalled();
            expect(document.body.textContent).toContain('Share with people?');

            await act(async () => { buttons('Share')[0]?.click(); });
            expect(access.current.save).toHaveBeenCalledTimes(1);
        });

        it('stops sharing with everyone after one confirm', async () => {
            access.current = idleAccess({ isShared: true, entries: [PERSON] });
            await open();

            await act(async () => { buttons('Stop sharing')[0]?.click(); });
            expect(access.current.stopSharing).not.toHaveBeenCalled();
            expect(document.body.textContent).toContain('The note stays in its folder.');

            // The confirm dialog's button comes after the footer's
            await act(async () => { buttons('Stop sharing').at(-1)?.click(); });
            expect(access.current.stopSharing).toHaveBeenCalledTimes(1);
        });

        it('has no Stop sharing for a note that is not shared', async () => {
            await open();

            expect(buttons('Stop sharing')).toHaveLength(0);
        });

        it('replaces the picker with the reason in a shared folder', async () => {
            await open({ inSharedFolder: true });

            expect(document.body.textContent).toContain('This note is in a shared folder, so it is public.');
            expect(document.querySelector('#share-search')).toBeNull();
        });

        it('lists the owner and each entry with a role menu', async () => {
            access.current = idleAccess({
                isShared: true,
                entries: [{ kind: 'circle', id: 'c1', role: 'editor' }, PERSON],
                circleName: () => 'Friends',
            });
            await open();

            const list = document.querySelector('ul[aria-label="People with access"]');
            expect(list?.textContent).toContain('Owner');
            const circleRole = document.querySelector<HTMLSelectElement>('select[aria-label="Role for Friends"]');
            expect(circleRole?.value).toBe('editor');
            const personRole = document.querySelector<HTMLSelectElement>('select[aria-label="Role for sam.id"]');
            expect(personRole?.value).toBe('viewer');
            const personEditor = personRole?.querySelector<HTMLOptionElement>('option[value="editor"]');
            expect(personEditor?.disabled).toBe(true);
            expect(personEditor?.textContent).toContain('Needs a Homebase server update');
        });
    });
});
