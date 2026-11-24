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
    revalidateOwner: vi.fn(),
    getConnections: vi.fn(),
    peerAccess: true as boolean | undefined,
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
    useSyncService: () => ({ syncService: { pullOwnerNow: mocks.pullOwnerNow, revalidateOwner: mocks.revalidateOwner } }),
}));
vi.mock('@/hooks/usePeerAccess', () => ({ usePeerAccess: () => mocks.peerAccess }));
vi.mock('@homebase-id/js-lib/network', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/network')>()),
    getConnections: mocks.getConnections,
}));
vi.mock('@/lib/db', () => ({ getSharedNoteOwners: vi.fn(async () => []) }));

import { getLogSnapshot, resetLogForTests } from '@/lib/diagnostics/logBuffer';
import { areShareNotificationsOff, resetShareNotificationsForTests } from '@/lib/homebase/shareNotifications';
import { SharePushProvider } from '@/lib/homebase/SharePushProvider';
import { pullOnSharePush, pullMissedSharePushes, useShareLinkPull, useSharePush } from '@/hooks/useSharePush';
import { useSharedPull } from '@/hooks/useSharedPull';
import {
    JOURNAL_APP_ID,
    JOURNAL_DRIVE,
    JOURNAL_PEER_SUBSCRIPTION_ID,
    JOURNAL_PUSH_TYPE_EDIT,
    JOURNAL_PUSH_TYPE_SHARE,
    JOURNAL_PUSH_TYPE_UNSHARE,
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
    resetShareNotificationsForTests();
    resetLogForTests();
    mocks.calls = [];
    mocks.getFileHeaderByUniqueId.mockResolvedValue(null);
    mocks.deleteFile.mockImplementation(async () => { mocks.calls.push('delete'); return true; });
    mocks.uploadFile.mockImplementation(async () => { mocks.calls.push('upload'); return {}; });
    mocks.MarkNotificationsAsRead.mockResolvedValue({});
    mocks.pullOwnerNow.mockResolvedValue(undefined);
    mocks.revalidateOwner.mockResolvedValue(undefined);
    mocks.GetNotifications.mockResolvedValue({ results: [] });
    mocks.peerAccess = true;
});

const sync = { pullOwnerNow: mocks.pullOwnerNow, revalidateOwner: mocks.revalidateOwner };

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

    // #1494: the removed people's apps drop the note without polling
    it('sends one UNSHARE push to the removed recipient only, with no title in the message', async () => {
        await send(['sam.dotyou.cloud'], ['sam.dotyou.cloud', 'merry.dotyou.cloud', OWNER]);

        expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
        const [, instructions, metadata] = upload();
        expect(instructions.transitOptions).toMatchObject({
            appNotificationOptions: {
                typeId: JOURNAL_PUSH_TYPE_UNSHARE,
                tagId: NOTE,
                unEncryptedMessage: 'Stopped sharing a note with you',
                peerSubscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID,
                recipients: ['merry.dotyou.cloud'],
            },
        });
        expect(JSON.stringify(upload())).not.toContain(TITLE);
        // Its own file, so it does not replace the share push's
        expect(metadata.appData.uniqueId).toBe(toGuidId(`unshare-push-${NOTE}`));
    });

    it('sends a share push to the added people and an unshare push to the removed ones', async () => {
        await send(['pippin.dotyou.cloud'], ['merry.dotyou.cloud']);

        const pushes = mocks.uploadFile.mock.calls.map(([, instructions]) => (instructions as UploadInstructionSet).transitOptions);
        expect(pushes).toEqual([
            expect.objectContaining({ appNotificationOptions: expect.objectContaining({ typeId: JOURNAL_PUSH_TYPE_SHARE, recipients: ['pippin.dotyou.cloud'] }) }),
            expect.objectContaining({ appNotificationOptions: expect.objectContaining({ typeId: JOURNAL_PUSH_TYPE_UNSHARE, recipients: ['merry.dotyou.cloud'] }) }),
        ]);
    });
});

describe('SharePushProvider.send when the drive does not allow subscriptions (#817)', () => {
    const refusal = (data: unknown = { message: 'App notification recipients can only be specified if the drive is a collaboration drive and allows subscriptions' }) =>
        Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data } });
    const send = (recipients: string[]) => new SharePushProvider(client).send(NOTE, recipients);

    it('logs one diagnostics entry for the 400 and stops pushing for the session', async () => {
        mocks.uploadFile.mockRejectedValue(refusal());

        await send(['sam.dotyou.cloud']);
        await send(['merry.dotyou.cloud']);
        await new SharePushProvider(client).send('22222222-2222-4222-8222-222222222222', ['pippin.dotyou.cloud']);

        expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
        expect(getLogSnapshot().filter((e) => e.message.includes('Share notifications are off'))).toEqual([
            expect.objectContaining({ level: 'warn' }),
        ]);
        expect(areShareNotificationsOff(OWNER)).toBe(true);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('treats a 400 with no body as the same refusal', async () => {
        mocks.uploadFile.mockRejectedValue(refusal(undefined));
        await send(['sam.dotyou.cloud']);
        expect(areShareNotificationsOff(OWNER)).toBe(true);
    });

    it('does not mistake another 400 or another status for it, and keeps trying', async () => {
        mocks.uploadFile.mockRejectedValueOnce(refusal({ message: 'Invalid drive id' }));
        mocks.uploadFile.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 403 } }));
        await send(['sam.dotyou.cloud']);
        await send(['sam.dotyou.cloud']);
        await send(['sam.dotyou.cloud']);

        expect(mocks.uploadFile).toHaveBeenCalledTimes(3);
        expect(areShareNotificationsOff(OWNER)).toBe(false);
        expect(getLogSnapshot()).toEqual([]);
        expect(console.warn).toHaveBeenCalledTimes(2);
    });
});

describe('pullOnSharePush', () => {
    const message = (typeId: string, senderId = OWNER) =>
        ({ type: 'journal-push', payload: { senderId, options: { appId: JOURNAL_APP_ID, typeId, tagId: NOTE } } });

    it('pulls only the sender of a share push', async () => {
        await pullOnSharePush(message(JOURNAL_PUSH_TYPE_SHARE), sync);
        expect(mocks.pullOwnerNow.mock.calls).toEqual([[OWNER]]);
        expect(mocks.revalidateOwner).not.toHaveBeenCalled();
    });

    // #1494
    it("checks the sender's notes on an unshare push", async () => {
        await pullOnSharePush(message(JOURNAL_PUSH_TYPE_UNSHARE), sync);
        expect(mocks.revalidateOwner.mock.calls).toEqual([[OWNER]]);
        expect(mocks.pullOwnerNow).not.toHaveBeenCalled();
    });

    it('does nothing for another push type or another message', () => {
        pullOnSharePush(message(JOURNAL_PUSH_TYPE_EDIT), sync);
        pullOnSharePush({ type: 'other', payload: message(JOURNAL_PUSH_TYPE_SHARE).payload }, sync);
        pullOnSharePush(null, sync);
        expect(mocks.pullOwnerNow).not.toHaveBeenCalled();
        expect(mocks.revalidateOwner).not.toHaveBeenCalled();
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

        await pullMissedSharePushes(client, sync);

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

        await pullMissedSharePushes(client, sync);

        expect(mocks.MarkNotificationsAsRead).toHaveBeenCalledWith(client, ['n2']);
    });

    it('marks nothing when every pull failed', async () => {
        mocks.GetNotifications.mockResolvedValue({ results: [entry('n1', 'a.id')] });
        mocks.pullOwnerNow.mockRejectedValue(new Error('offline'));

        await pullMissedSharePushes(client, sync);

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

        await pullMissedSharePushes(client, sync);

        expect(mocks.pullOwnerNow).toHaveBeenCalledTimes(6);
        expect(peak).toBe(4);
    });

    // #1494: an owner with only an unshare push has its notes checked; one with a share push too is pulled
    it('checks the notes of an owner with an unread unshare push, and pulls an owner with both', async () => {
        mocks.GetNotifications.mockResolvedValue({
            results: [
                entry('n1', 'a.id', JOURNAL_PUSH_TYPE_UNSHARE),
                entry('n2', 'b.id', JOURNAL_PUSH_TYPE_UNSHARE),
                entry('n3', 'b.id', JOURNAL_PUSH_TYPE_SHARE),
            ],
        });

        await pullMissedSharePushes(client, sync);

        expect(mocks.revalidateOwner.mock.calls).toEqual([['a.id']]);
        expect(mocks.pullOwnerNow.mock.calls).toEqual([['b.id']]);
        expect([...mocks.MarkNotificationsAsRead.mock.calls[0][1]].sort()).toEqual(['n1', 'n2', 'n3']);
    });
});

// #1494: shared notes come by push, invite, share link or Refresh, never by a timer
describe('no polling', () => {
    async function openApp() {
        let shared: ReturnType<typeof useSharedPull> | undefined;
        function Probe() {
            useSharePush();
            shared = useSharedPull();
            return null;
        }
        const root = createRoot(document.createElement('div'));
        await act(async () => { root.render(h(Probe)); });
        return { shared: () => shared!, unmount: () => act(async () => root.unmount()) };
    }

    it('makes no peer call with 50 connections and no pushes, however long the app stays open', async () => {
        mocks.getConnections.mockResolvedValue({
            results: Array.from({ length: 50 }, (_, i) => ({ odinId: `c${i}.dotyou.cloud` })),
            cursor: undefined,
        });
        vi.useFakeTimers();
        try {
            const app = await openApp();
            await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60 * 60_000); });

            expect(mocks.GetNotifications).toHaveBeenCalledTimes(1);
            expect(mocks.pullOwnerNow).not.toHaveBeenCalled();
            expect(mocks.revalidateOwner).not.toHaveBeenCalled();
            expect(mocks.getConnections).not.toHaveBeenCalled();
            await app.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it('without peer access reads no pushes, ignores a live one and offers no Refresh', async () => {
        mocks.peerAccess = false;
        const sw = new EventTarget();
        Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
        try {
            const app = await openApp();
            sw.dispatchEvent(new MessageEvent('message', {
                data: { type: 'journal-push', payload: { senderId: OWNER, options: { appId: JOURNAL_APP_ID, typeId: JOURNAL_PUSH_TYPE_SHARE, tagId: NOTE } } },
            }));
            await act(async () => { await app.shared().refresh(); });

            expect(app.shared().canPull).toBe(false);
            expect(mocks.GetNotifications).not.toHaveBeenCalled();
            expect(mocks.pullOwnerNow).not.toHaveBeenCalled();
            await app.unmount();
        } finally {
            Reflect.deleteProperty(navigator, 'serviceWorker');
        }
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

    // #1494: the viewer's own server would refuse the pull
    it('makes no pull without peer access, and stops pending', async () => {
        mocks.peerAccess = false;
        const { seen, unmount } = await mount(`/shared/${NOTE}?from=${OWNER}`, false, false);
        expect(mocks.pullOwnerNow).not.toHaveBeenCalled();
        expect(seen.at(-1)).toBe(false);
        await unmount();
    });
});
