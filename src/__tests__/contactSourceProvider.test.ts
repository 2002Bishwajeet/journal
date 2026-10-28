import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@homebase-id/js-lib/public', () => ({
    GetProfileCard: vi.fn().mockResolvedValue({ name: 'Frodo' }),
    GetProfileImage: vi.fn(() => {
        throw new Error('js-lib GetProfileImage must not be used');
    }),
}));

const peer = vi.hoisted(() => ({ resolvers: [] as ((value: unknown) => void)[] }));
vi.mock('@homebase-id/js-lib/peer', () => ({
    getProfileAttributesOverPeer: vi.fn(() => new Promise((resolve) => peer.resolvers.push(resolve))),
    getDecryptedImageDataOverPeer: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/network', () => ({ getConnectionInfo: vi.fn().mockResolvedValue({ status: 'connected' }) }));

import type { DotYouClient } from '@homebase-id/js-lib/core';
import { fetchConnectionInfo, fetchDataFromPublic } from '@/lib/providers/ContactSourceProvider';

afterEach(() => vi.unstubAllGlobals());

describe('fetchDataFromPublic', () => {
    it('fetches https://<identity>/pub/image directly', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
        );
        vi.stubGlobal('fetch', fetchMock);

        const contact = await fetchDataFromPublic('frodo.dotyou.cloud');

        expect(fetchMock).toHaveBeenCalledWith('https://frodo.dotyou.cloud/pub/image');
        expect(contact?.name?.displayName).toBe('Frodo');
        expect(contact?.image?.contentType).toBe('image/png');
        expect(contact?.image?.content).toBeTruthy();
    });

    it('returns no image when the fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
        const contact = await fetchDataFromPublic('frodo.dotyou.cloud');
        expect(contact?.image).toBeUndefined();
    });
});

describe('fetchConnectionInfo', () => {
    it('reads the six profile attributes over peer at the same time', async () => {
        const contact = fetchConnectionInfo({} as DotYouClient, 'frodo.dotyou.cloud');

        // All six requests start before any answers
        await vi.waitFor(() => expect(peer.resolvers).toHaveLength(6));
        const [name, ...rest] = peer.resolvers;
        name([{ fileMetadata: { appData: { content: { data: { displayName: 'Frodo' } } } } }]);
        for (const resolve of rest) resolve([]);

        expect((await contact)?.name?.displayName).toBe('Frodo');
        expect((await contact)?.source).toBe('contact');
    });
});
