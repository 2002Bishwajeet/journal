// @vitest-environment happy-dom
/**
 * #745: the owner's share push and the recipient's pull of that owner. js-lib is mocked
 * at the drive and notification calls; the pull (#732) is a spy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { toGuidId } from '@homebase-id/js-lib/helpers';
import { SecurityGroupType, type DotYouClient, type UploadFileMetadata, type UploadInstructionSet } from '@homebase-id/js-lib/core';

const mocks = vi.hoisted(() => ({
    calls: [] as string[],
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    getFileHeaderByUniqueId: vi.fn(),
    GetNotifications: vi.fn(),
    MarkNotificationsAsRead: vi.fn(),
    pullOwnerNow: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/core')>()),
    uploadFile: mocks.uploadFile,
    deleteFile: mocks.deleteFile,
    getFileHeaderByUniqueId: mocks.getFileHeaderByUniqueId,
    GetNotifications: mocks.GetNotifications,
    MarkNotificationsAsRead: mocks.MarkNotificationsAsRead,
}));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => client }));
vi.mock('@/hooks/useSyncService', () => ({
    useSyncService: () => ({ syncService: { pullOwnerNow: mocks.pullOwnerNow } }),
}));

import { SharePushProvider } from '@/lib/homebase/SharePushProvider';
import { pullOnSharePush, pullMissedSharePushes, useShareLinkPull } from '@/hooks/useSharePush';
import {
    JOURNAL_APP_ID,
    JOURNAL_DRIVE,
    JOURNAL_PEER_SUBSCRIPTION_ID,
    JOURNAL_PUSH_TYPE_EDIT,
    JOURNAL_PUSH_TYPE_SHARE,
    SHARE_PUSH_FILE_TYPE,
} from '@/lib/homebase/config';

const OWNER = 'frodo.dotyou.cloud';
const NOTE = '11111111-1111-4111-8111-111111111111';
const TITLE = 'Secret plans';
const client = { getHostIdentity: () => OWNER } as unknown as DotYouClient;

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.calls = [];
    mocks.getFileHeaderByUniqueId.mockResolvedValue(null);
    mocks.deleteFile.mockImplementation(async () => { mocks.calls.push('delete'); return true; });
    mocks.uploadFile.mockImplementation(async () => { mocks.calls.push('upload'); return {}; });
    mocks.MarkNotificationsAsRead.mockResolvedValue({});
    mocks.pullOwnerNow.mockResolvedValue(undefined);
});

describe('SharePushProvider.send', () => {
    const send = (recipients: string[], previous?: string[]) =>
        new SharePushProvider(client).send(NOTE, recipients, previous);
    const upload = () => mocks.uploadFile.mock.calls[0] as [DotYouClient, UploadInstructionSet, UploadFileMetadata, ...unknown[]];

    it('uploads one Owner-only file with only notification options', async () => {
        await send(['sam.dotyou.cloud', 'merry.dotyou.cloud']);

        expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
        const [, instructions, metadata] = upload();
        expect(instructions.storageOptions?.drive).toEqual(JOURNAL_DRIVE);
        expect(instructions.transitOptions).toEqual({
            useAppNotification: true,
            appNotificationOptions: {
                appId: JOURNAL_APP_ID,
                typeId: JOURNAL_PUSH_TYPE_SHARE,
                tagId: NOTE,
                silent: false,
                unEncryptedMessage: 'Shared a note with you',
                peerSubscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID,
                recipients: ['sam.dotyou.cloud', 'merry.dotyou.cloud'],
            },
        });
        expect(instructions.transitOptions).not.toHaveProperty('recipients');
        expect(metadata.appData).toEqual({
            fileType: SHARE_PUSH_FILE_TYPE,
            uniqueId: toGuidId(`share-push-${NOTE}`),
            content: JSON.stringify({ noteId: NOTE }),
        });
        expect(metadata.accessControlList).toEqual({ requiredSecurityGroup: SecurityGroupType.Owner });
    });

    it('never puts the note title in the push', async () => {
        await send(['sam.dotyou.cloud']);
        expect(JSON.stringify(upload())).not.toContain(TITLE);
    });

    it('pushes only the recipients the note did not have before, never the owner', async () => {
        await send(['sam.dotyou.cloud', 'merry.dotyou.cloud', OWNER], ['sam.dotyou.cloud']);
        expect(upload()[1].transitOptions).toMatchObject({ appNotificationOptions: { recipients: ['merry.dotyou.cloud'] } });
    });

    it('uploads nothing when nobody is new', async () => {
        await send(['sam.dotyou.cloud'], ['sam.dotyou.cloud']);
        expect(mocks.uploadFile).not.toHaveBeenCalled();
        expect(mocks.getFileHeaderByUniqueId).not.toHaveBeenCalled();
    });

    it('deletes the previous share-event file before the new upload', async () => {
        mocks.getFileHeaderByUniqueId.mockResolvedValue({ fileId: 'old-file' });
        await send(['sam.dotyou.cloud']);

        expect(mocks.getFileHeaderByUniqueId).toHaveBeenCalledWith(client, JOURNAL_DRIVE, toGuidId(`share-push-${NOTE}`), { decrypt: false });
        expect(mocks.deleteFile).toHaveBeenCalledWith(client, JOURNAL_DRIVE, 'old-file');
        expect(mocks.calls).toEqual(['delete', 'upload']);
    });

    it('resolves when the upload fails, so the share still succeeds', async () => {
        mocks.uploadFile.mockRejectedValue(new Error('403'));
        await expect(send(['sam.dotyou.cloud'])).resolves.toBeUndefined();
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('pullOnSharePush', () => {
    const message = (typeId: string, senderId = OWNER) =>
        ({ type: 'journal-push', payload: { senderId, options: { appId: JOURNAL_APP_ID, typeId, tagId: NOTE } } });

    it('pulls the sender of a share push', async () => {
        await pullOnSharePush(message(JOURNAL_PUSH_TYPE_SHARE), mocks.pullOwnerNow);
        expect(mocks.pullOwnerNow).toHaveBeenCalledWith(OWNER);
    });

    it('does nothing for another push type or another message', () => {
        pullOnSharePush(message(JOURNAL_PUSH_TYPE_EDIT), mocks.pullOwnerNow);
        pullOnSharePush({ type: 'other', payload: message(JOURNAL_PUSH_TYPE_SHARE).payload }, mocks.pullOwnerNow);
        pullOnSharePush(null, mocks.pullOwnerNow);
        expect(mocks.pullOwnerNow).not.toHaveBeenCalled();
    });
});

describe('pullMissedSharePushes', () => {
    const entry = (id: string, senderId: string, typeId = JOURNAL_PUSH_TYPE_SHARE, unread = true) =>
        ({ id, senderId, unread, created: 0, options: { appId: JOURNAL_APP_ID, typeId, tagId: NOTE, silent: false } });

    it('pulls each owner with unread share pushes once, then marks those entries read', async () => {
        mocks.GetNotifications.mockResolvedValue({
            results: [
                entry('n1', 'a.id'),
                entry('n2', 'b.id'),
                entry('n3', 'a.id'),
                entry('n4', 'c.id', JOURNAL_PUSH_TYPE_EDIT),
                entry('n5', 'd.id', JOURNAL_PUSH_TYPE_SHARE, false),
            ],
        });

        await pullMissedSharePushes(client, mocks.pullOwnerNow);

        expect(mocks.GetNotifications).toHaveBeenCalledWith(client, JOURNAL_APP_ID, expect.any(Number), undefined);
        expect(mocks.pullOwnerNow.mock.calls.map(([id]) => id).sort()).toEqual(['a.id', 'b.id']);
        expect(mocks.MarkNotificationsAsRead).toHaveBeenCalledTimes(1);
        expect([...mocks.MarkNotificationsAsRead.mock.calls[0][1]].sort()).toEqual(['n1', 'n2', 'n3']);
    });

    it('leaves the entries of an owner whose pull failed unread', async () => {
        mocks.GetNotifications.mockResolvedValue({ results: [entry('n1', 'a.id'), entry('n2', 'b.id')] });
        mocks.pullOwnerNow.mockImplementation(async (id: string) => {
            if (id === 'a.id') throw new Error('a.id did not answer');
        });

        await pullMissedSharePushes(client, mocks.pullOwnerNow);

        expect(mocks.MarkNotificationsAsRead).toHaveBeenCalledWith(client, ['n2']);
    });

    it('marks nothing when every pull failed', async () => {
        mocks.GetNotifications.mockResolvedValue({ results: [entry('n1', 'a.id')] });
        mocks.pullOwnerNow.mockRejectedValue(new Error('offline'));

        await pullMissedSharePushes(client, mocks.pullOwnerNow);

        expect(mocks.MarkNotificationsAsRead).not.toHaveBeenCalled();
    });

    it('pulls at most 4 owners at a time', async () => {
        mocks.GetNotifications.mockResolvedValue({
            results: Array.from({ length: 6 }, (_, i) => entry(`n${i}`, `owner${i}.id`)),
        });
        let running = 0;
        let peak = 0;
        mocks.pullOwnerNow.mockImplementation(async () => {
            peak = Math.max(peak, ++running);
            await new Promise((r) => setTimeout(r, 1));
            running--;
        });

        await pullMissedSharePushes(client, mocks.pullOwnerNow);

        expect(mocks.pullOwnerNow).toHaveBeenCalledTimes(6);
        expect(peak).toBe(4);
    });
});

describe('useShareLinkPull', () => {
    async function mount(url: string, isLoading: boolean, isLocal: boolean) {
        const seen: boolean[] = [];
        function Probe() {
            seen.push(useShareLinkPull(NOTE, isLoading, isLocal));
            return null;
        }
        const root = createRoot(document.createElement('div'));
        await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Probe))); });
        return { seen, unmount: () => act(async () => root.unmount()) };
    }

    it('pulls the owner in ?from= for a missing note, then stops pending', async () => {
        const { seen, unmount } = await mount(`/shared/${NOTE}?from=${OWNER}`, false, false);
        expect(mocks.pullOwnerNow).toHaveBeenCalledWith(OWNER);
        expect(seen[0]).toBe(true);
        expect(seen.at(-1)).toBe(false);
        await unmount();
    });

    it('stops pending even when the pull fails, so the page can say "not found"', async () => {
        mocks.pullOwnerNow.mockRejectedValue(new Error('404'));
        const { seen, unmount } = await mount(`/shared/${NOTE}?from=${OWNER}`, false, false);
        expect(seen.at(-1)).toBe(false);
        await unmount();
    });

    it('waits for the note list before pulling', async () => {
        const { seen, unmount } = await mount(`/shared/${NOTE}?from=${OWNER}`, true, false);
        expect(mocks.pullOwnerNow).not.toHaveBeenCalled();
        expect(seen.at(-1)).toBe(true);
        await unmount();
    });

    it('does nothing for a local note or without ?from=', async () => {
        const local = await mount(`/shared/${NOTE}?from=${OWNER}`, false, true);
        const plain = await mount(`/shared/${NOTE}`, false, false);
        expect(mocks.pullOwnerNow).not.toHaveBeenCalled();
        expect(local.seen.at(-1)).toBe(false);
        expect(plain.seen.at(-1)).toBe(false);
        await local.unmount();
        await plain.unmount();
    });
});
