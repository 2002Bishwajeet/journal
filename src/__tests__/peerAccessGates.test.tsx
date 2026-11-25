// @vitest-environment happy-dom
/**
 * #1494: without peer read or send on the app's token, the host's own server answers every
 * peer call 403. So the peer note check, the peer websocket, peer images, thumbnails, image
 * download and link previews make no peer request; with the permission they do.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement as h, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiType, type DotYouClient, type TargetDrive } from '@homebase-id/js-lib/core';
import type { SyncService } from '@/lib/homebase/SyncService';

const m = vi.hoisted(() => ({
    access: true as boolean | undefined,
    // Empty url: the download stops before fetch()
    getDecryptedImageUrlOverPeer: vi.fn(async () => ''),
    getDecryptedImageUrlOverPeerByGlobalTransitId: vi.fn(async () => 'blob:peer'),
    getDecryptedThumbnailMetaOverPeer: vi.fn(async () => null),
    getPayloadAsJsonOverPeer: vi.fn(async () => []),
    getPayloadAsJsonOverPeerByGlobalTransitId: vi.fn(async () => []),
    SubscribeOverPeer: vi.fn(async () => {}),
    UnsubscribeOverPeer: vi.fn(),
    NotifyOverPeer: vi.fn(),
}));
vi.mock('@/hooks/usePeerAccess', () => ({ usePeerAccess: () => m.access }));
vi.mock('@homebase-id/js-lib/peer', () => ({
    getDecryptedImageUrlOverPeer: m.getDecryptedImageUrlOverPeer,
    getDecryptedImageUrlOverPeerByGlobalTransitId: m.getDecryptedImageUrlOverPeerByGlobalTransitId,
    getDecryptedThumbnailMetaOverPeer: m.getDecryptedThumbnailMetaOverPeer,
    getPayloadAsJsonOverPeer: m.getPayloadAsJsonOverPeer,
    getPayloadAsJsonOverPeerByGlobalTransitId: m.getPayloadAsJsonOverPeerByGlobalTransitId,
    SubscribeOverPeer: m.SubscribeOverPeer,
    UnsubscribeOverPeer: m.UnsubscribeOverPeer,
    NotifyOverPeer: m.NotifyOverPeer,
}));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => client }));
vi.mock('@/lib/db', () => ({ getLocalImageBytes: vi.fn(async () => null), getPendingImageUpload: vi.fn(async () => null) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/images/imageDownload', () => ({ imageFilename: () => 'image.png', saveBlob: vi.fn() }));

import { usePeerNoteContent } from '@/hooks/usePeerNoteContent';
import { useWebsocketSubscriber } from '@/hooks/useWebsocketSubscriber';
import { useImage } from '@/hooks/image/useImage';
import { useTinyThumb } from '@/hooks/image/useTinyThumb';
import { useImageDownload } from '@/hooks/image/useImageDownload';
import { useLinkMetadata } from '@/hooks/links/useLinkMetadata';
import { ImageOwnerContext } from '@/components/editor/nodes/imageOwnerContext';

const HOST = 'me.example.com';
const AUTHOR = 'author.example.com';
const DRIVE: TargetDrive = { alias: 'a', type: 'b' };
// Stable across renders, so the subscriber doesn't re-subscribe on every render
const onNotification = () => {};
const TYPES: [] = [];
const DRIVES = [DRIVE];
const client = {
    getHostIdentity: () => HOST,
    getType: () => ApiType.App,
    getSharedSecret: () => new Uint8Array([1]),
} as unknown as DotYouClient;

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
beforeEach(() => {
    vi.clearAllMocks();
    m.access = true;
    root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

async function renderHook<T>(hook: () => T, wrap: (node: ReactNode) => ReactNode = (n) => n) {
    const result: { current: T | undefined } = { current: undefined };
    function Probe() { result.current = hook(); return null; }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(h(QueryClientProvider, { client: queryClient }, wrap(h(Probe)))); });
    await flush();
    return result;
}

describe.each([false, undefined])('peer access %s', (access) => {
    beforeEach(() => { m.access = access; });

    it('opening a peer note asks the author nothing, so a 403 cannot delete the local copy', async () => {
        const syncService = {
            ensurePeerNoteContent: vi.fn(async () => ({ status: 'local' })),
            revalidatePeerNote: vi.fn(async () => 'removed'),
        } as unknown as SyncService;
        const onRevoked = vi.fn();
        const result = await renderHook(() => usePeerNoteContent({
            docId: 'doc-1', authorOdinId: AUTHOR, isEnabled: true, syncService, onRevoked,
        }));
        expect(syncService.ensurePeerNoteContent).not.toHaveBeenCalled();
        expect(syncService.revalidatePeerNote).not.toHaveBeenCalled();
        expect(onRevoked).not.toHaveBeenCalled();
        // The copy on this device opens while access is unknown or missing, never a loading wait
        expect(result.current?.status).toBe('local');
    });

    it('makes no peer websocket subscription', async () => {
        await renderHook(() => useWebsocketSubscriber(onNotification, AUTHOR, TYPES, DRIVES));
        expect(m.SubscribeOverPeer).not.toHaveBeenCalled();
    });

    it('fetches no peer image or thumbnail', async () => {
        await renderHook(() => {
            useImage({ dotYouClient: client, odinId: AUTHOR, imageFileId: 'f', imageGlobalTransitId: 'g', imageFileKey: 'k', imageDrive: DRIVE });
            useImage({ dotYouClient: client, odinId: AUTHOR, imageFileId: 'f2', imageFileKey: 'k', imageDrive: DRIVE });
            useTinyThumb(client, AUTHOR, 'f', 'g', 'k', DRIVE);
        });
        expect(m.getDecryptedImageUrlOverPeerByGlobalTransitId).not.toHaveBeenCalled();
        expect(m.getDecryptedImageUrlOverPeer).not.toHaveBeenCalled();
        expect(m.getDecryptedThumbnailMetaOverPeer).not.toHaveBeenCalled();
    });

    it('downloads no image over peer', async () => {
        const download = await renderHook(
            () => useImageDownload('attachment://f/k', 'alt'),
            (node) => h(ImageOwnerContext.Provider, { value: AUTHOR }, node),
        );
        await act(async () => { await download.current?.(); });
        expect(m.getDecryptedImageUrlOverPeer).not.toHaveBeenCalled();
    });

    it('fetches no peer link preview', async () => {
        await renderHook(() => useLinkMetadata({ odinId: AUTHOR, globalTransitId: 'g', targetDrive: DRIVE, fileId: 'f', payloadKey: 'k' }));
        expect(m.getPayloadAsJsonOverPeerByGlobalTransitId).not.toHaveBeenCalled();
    });
});

describe('with peer access', () => {
    it('checks the peer note against the author', async () => {
        const syncService = {
            ensurePeerNoteContent: vi.fn(async () => ({ status: 'local' })),
            revalidatePeerNote: vi.fn(async () => 'unchanged'),
        } as unknown as SyncService;
        await renderHook(() => usePeerNoteContent({ docId: 'doc-1', authorOdinId: AUTHOR, isEnabled: true, syncService }));
        expect(syncService.ensurePeerNoteContent).toHaveBeenCalledWith('doc-1', AUTHOR);
        expect(syncService.revalidatePeerNote).toHaveBeenCalledWith('doc-1', AUTHOR);
    });

    it('keeps the local copy up when access arrives after the note opened, so the editor is not remounted', async () => {
        m.access = undefined;
        let finish: (r: { status: 'local' }) => void = () => {};
        const syncService = {
            ensurePeerNoteContent: vi.fn(() => new Promise((r) => { finish = r; })),
            revalidatePeerNote: vi.fn(async () => 'unchanged'),
        } as unknown as SyncService;
        const statuses: string[] = [];
        function Probe() {
            statuses.push(usePeerNoteContent({ docId: 'doc-1', authorOdinId: AUTHOR, isEnabled: true, syncService }).status);
            return null;
        }
        await act(async () => { root.render(h(Probe)); });
        // The security context loads (or fails, which reads as access): the author is asked now.
        m.access = true;
        await act(async () => { root.render(h(Probe)); });
        await flush();
        expect(syncService.ensurePeerNoteContent).toHaveBeenCalledWith('doc-1', AUTHOR);
        await act(async () => finish({ status: 'local' }));
        expect(syncService.revalidatePeerNote).toHaveBeenCalledWith('doc-1', AUTHOR);
        expect(new Set(statuses)).toEqual(new Set(['local']));
    });

    it('subscribes over peer and fetches peer images, thumbnails, downloads and link previews', async () => {
        await renderHook(() => {
            useWebsocketSubscriber(onNotification, AUTHOR, TYPES, DRIVES);
            useImage({ dotYouClient: client, odinId: AUTHOR, imageFileId: 'f', imageGlobalTransitId: 'g', imageFileKey: 'k', imageDrive: DRIVE });
            useTinyThumb(client, AUTHOR, 'f', 'g', 'k', DRIVE);
            useLinkMetadata({ odinId: AUTHOR, globalTransitId: 'g', targetDrive: DRIVE, fileId: 'f', payloadKey: 'k' });
        });
        expect(m.SubscribeOverPeer).toHaveBeenCalled();
        expect(m.getDecryptedImageUrlOverPeerByGlobalTransitId).toHaveBeenCalled();
        expect(m.getDecryptedThumbnailMetaOverPeer).toHaveBeenCalled();
        expect(m.getPayloadAsJsonOverPeerByGlobalTransitId).toHaveBeenCalled();

        await act(async () => root.unmount());
        root = createRoot(document.createElement('div'));
        const download = await renderHook(
            () => useImageDownload('attachment://f/k', 'alt'),
            (node) => h(ImageOwnerContext.Provider, { value: AUTHOR }, node),
        );
        await act(async () => { await download.current?.(); });
        expect(m.getDecryptedImageUrlOverPeer).toHaveBeenCalled();
    });
});
