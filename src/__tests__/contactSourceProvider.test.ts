import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@homebase-id/js-lib/public', () => ({
    GetProfileCard: vi.fn().mockResolvedValue({ name: 'Frodo' }),
    GetProfileImage: vi.fn(() => {
        throw new Error('js-lib GetProfileImage must not be used');
    }),
}));

import { fetchDataFromPublic } from '@/lib/providers/ContactSourceProvider';

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
