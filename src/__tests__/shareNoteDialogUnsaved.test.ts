// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE_ID = 'note-1';
const { access } = vi.hoisted(() => ({ access: { current: {} as Record<string, unknown> } }));

vi.mock('@/hooks/useShareAccess', () => ({
    useShareAccess: () => ({ ...access.current, note: undefined }),
}));
vi.mock('@/hooks/useMakeNotesPublic', () => ({
    useMakeNotesPublic: () => ({ isMakingPublic: false, isMakingPrivate: false }),
}));
vi.mock('@/hooks/useShareRequest', () => ({ useClearShareRequest: () => vi.fn() }));
vi.mock('@/hooks/useSheetMode', () => ({ useSheetMode: () => false }));
vi.mock('@/hooks/auth/useMissingPermissions', () => ({ useMissingPermissions: () => undefined }));
vi.mock('@/hooks/auth/useYouAuthAuthorization', () => ({ journalDriveRequest: {} }));
vi.mock('@/components/share/SharePeopleSection', () => ({ SharePeopleSection: () => null }));
vi.mock('@/components/share/ShareGeneralAccess', () => ({
    Notice: () => null,
    ShareGeneralAccess: () => null,
    ShareLinkPreview: () => null,
}));
vi.mock('@/components/share/ShareToFeed', () => ({ ShareToFeed: () => null }));

import ShareNoteDialog from '@/components/modals/ShareNoteDialog';

const buttons = (label: string) => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);

function idleAccess(overrides: Record<string, unknown> = {}) {
    return {
        entries: [],
        isShared: false,
        isDirty: false,
        isSaving: false,
        requestRefused: [],
        query: '',
        setQuery: vi.fn(),
        save: vi.fn(async () => ({ shared: true })),
        stopSharing: vi.fn(async () => true),
        ...overrides,
    };
}

describe('ShareNoteDialog unsaved access changes', () => {
    let host: HTMLDivElement;
    let root: Root;
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        access.current = idleAccess();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        host.remove();
    });

    const open = () => act(async () => {
        root.render(createElement(ShareNoteDialog, { isOpen: true, onClose, noteId: NOTE_ID, noteTitle: 'T' }));
    });
    const pressEscape = () => act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    it('says Done with no change and Save with a pending change, and Save applies it', async () => {
        await open();
        expect(buttons('Done')).toHaveLength(1);
        expect(buttons('Save')).toHaveLength(0);

        access.current = idleAccess({ isDirty: true, entries: [{}] });
        await open();
        expect(buttons('Done')).toHaveLength(0);
        await act(async () => { buttons('Save')[0]?.click(); });
        expect(access.current.save).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
    });

    it('closes at once when nothing changed', async () => {
        await open();
        await pressEscape();
        expect(onClose).toHaveBeenCalled();
        expect(document.body.textContent).not.toContain('Discard changes?');
    });

    it('asks before discarding, and Keep editing keeps the changes', async () => {
        access.current = idleAccess({ isDirty: true, entries: [{}] });
        await open();
        await pressEscape();
        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Discard changes?');

        await act(async () => { buttons('Keep editing')[0]?.click(); });
        expect(onClose).not.toHaveBeenCalled();
        expect(access.current.save).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toContain('Discard changes?');
    });

    it('Discard closes without saving', async () => {
        access.current = idleAccess({ isDirty: true, entries: [{}] });
        await open();
        await pressEscape();
        await act(async () => { buttons('Discard')[0]?.click(); });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(access.current.save).not.toHaveBeenCalled();
    });
});
