// @vitest-environment happy-dom
/** #730: after a share whose recipients got Read only, the dialog stays open and says so. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { share, personSharing } = vi.hoisted(() => ({ share: vi.fn(), personSharing: { value: true as boolean | undefined } }));

vi.mock('@/hooks/useNoteCollaboration', () => ({ useNoteCollaboration: () => ({ share }) }));
vi.mock('@/hooks/circles/useCircles', () => ({
    useCircles: () => ({ fetch: { data: [{ id: 'c1', name: 'Friends' }], isLoading: false } }),
}));
vi.mock('@/hooks/usePersonSharingSupported', () => ({ usePersonSharingSupported: () => personSharing.value }));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({ getHostIdentity: () => 'me.id' }) }));
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
        personSharing.value = true;
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

    // #897: people are added by identity, as viewers
    async function typePerson(text: string) {
        const field = document.querySelector<HTMLInputElement>('#share-person')!;
        await act(async () => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setValue.call(field, text);
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => { buttonWith('Add')?.click(); });
    }

    it('shares with a typed person, lowercased, and refuses the owner', async () => {
        share.mockResolvedValue({ shared: true });
        await act(async () => {
            root.render(createElement(MarkCollaborativeDialog, { isOpen: true, onClose, onSuccess, noteId: 'n1', noteTitle: 'T' }));
        });

        await typePerson('me.id');
        expect(document.body.textContent).toContain("You can't share a note with yourself");
        await typePerson('https://Sam.DotYou.Cloud/');
        expect(document.querySelector('ul[aria-label="People"]')?.textContent).toContain('sam.dotyou.cloud');
        await act(async () => { buttonWith('Share with 1 person')?.click(); });

        expect(share).toHaveBeenCalledWith('n1', { circles: [], odinIds: ['sam.dotyou.cloud'] });
    });

    it('starts from the people and circles an existing share names', async () => {
        await act(async () => {
            root.render(createElement(MarkCollaborativeDialog, {
                isOpen: true, onClose, onSuccess, noteId: 'n1', noteTitle: 'T', circleIds: ['c1'], odinIds: ['sam.id'],
            }));
        });

        expect(buttonWith('Share with 1 circle and 1 person')).toBeDefined();
    });

    it('disables adding people, with the reason, on a server without person sharing', async () => {
        personSharing.value = false;
        await act(async () => {
            root.render(createElement(MarkCollaborativeDialog, { isOpen: true, onClose, onSuccess, noteId: 'n1', noteTitle: 'T' }));
        });

        expect(document.querySelector<HTMLInputElement>('#share-person')?.disabled).toBe(true);
        expect(document.body.textContent).toContain('Your Homebase server is too old to share a note with a person.');
    });
});
