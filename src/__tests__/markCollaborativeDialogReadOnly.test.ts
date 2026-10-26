// @vitest-environment happy-dom
/** #730: after a share whose recipients got Read only, the dialog stays open and says so. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { share } = vi.hoisted(() => ({ share: vi.fn() }));

vi.mock('@/hooks/useNoteCollaboration', () => ({ useNoteCollaboration: () => ({ share }) }));
vi.mock('@/hooks/circles/useCircles', () => ({
    useCircles: () => ({ fetch: { data: [{ id: 'c1', name: 'Friends' }], isLoading: false } }),
}));
vi.mock('@/hooks/auth/useMissingPermissions', () => ({ useMissingPermissions: () => undefined }));
vi.mock('@/hooks/auth/useYouAuthAuthorization', () => ({ journalDriveRequest: {} }));
vi.mock('@/components/circles/CircleOption', () => ({
    CircleOption: ({ circle, onSelect }: { circle: { name: string }; onSelect: () => void }) =>
        createElement('button', { onClick: onSelect }, circle.name),
}));

import { MarkCollaborativeDialog } from '@/components/modals/MarkCollaborativeDialog';

const DRIVE_URL = 'https://me.id/owner/apps/console/drives/alias_type';
const buttonWith = (text: string) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('MarkCollaborativeDialog read-only notice', () => {
    let host: HTMLDivElement;
    let root: Root;
    const onClose = vi.fn();
    const onSuccess = vi.fn();

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

    async function shareWithFriends() {
        await act(async () => {
            root.render(createElement(MarkCollaborativeDialog, { isOpen: true, onClose, onSuccess, noteId: 'n1', noteTitle: 'T' }));
        });
        await act(async () => { buttonWith('Friends')?.click(); });
        await act(async () => { buttonWith('Share with 1 circle')?.click(); });
    }

    it('stays open with the message and the drive settings link', async () => {
        share.mockResolvedValue({ shared: true, readOnlyDriveUrl: DRIVE_URL });
        await shareWithFriends();

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain("People you share with can read this note but can't edit it yet.");
        const link = document.querySelector<HTMLAnchorElement>('a[aria-label^="Open drive settings"]');
        expect(link?.href).toBe(DRIVE_URL);
        expect(link?.target).toBe('_blank');

        await act(async () => { buttonWith('Done')?.click(); });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes right away when there is nothing to say', async () => {
        share.mockResolvedValue({ shared: true });
        await shareWithFriends();

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toContain("can't edit it yet");
    });

    it('stays on the circle list when the share failed', async () => {
        share.mockResolvedValue({ shared: false });
        await shareWithFriends();

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(buttonWith('Share with 1 circle')).toBeDefined();
    });
});
