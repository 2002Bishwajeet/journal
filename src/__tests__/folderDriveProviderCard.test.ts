/**
 * #644: the folder link card payload through FolderDriveProvider's two write paths:
 * a patch uploads a new card; a re-upload (share/unshare flips encryption) keeps the
 * existing card, or stops naming it when it can't be read.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeDotYouClient } from './fakes';

const { uploadFile, patchFile, getFileHeader, getPayloadBytes } = vi.hoisted(() => ({
    uploadFile: vi.fn(), patchFile: vi.fn(), getFileHeader: vi.fn(), getPayloadBytes: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (orig) => ({
    ...(await orig<object>()), uploadFile, patchFile, getFileHeader, getPayloadBytes,
}));

import { FolderDriveProvider } from '@/lib/homebase/FolderDriveProvider';
import { PAYLOAD_KEY_CARD_IMAGE } from '@/lib/homebase/config';
import type { FolderFile } from '@/types';

const card = { cardImageKey: PAYLOAD_KEY_CARD_IMAGE, from: { name: 'Trips', count: 0 } };
const header = (isEncrypted: boolean, withPayload = true) => ({
    fileId: 'f1',
    sharedSecretEncryptedKeyHeader: undefined,
    fileMetadata: {
        isEncrypted,
        versionTag: 'v1',
        appData: { uniqueId: 'u1', content: JSON.stringify({ name: 'Trips', card, color: 'red' }) },
        payloads: withPayload ? [{ key: PAYLOAD_KEY_CARD_IMAGE, lastModified: 1 }] : [],
    },
});
const folder = (isPublic: boolean, extra: Partial<FolderFile> = {}) => ({ name: 'Trips', isPublic, ...extra }) as FolderFile;

let provider: FolderDriveProvider;
beforeEach(() => {
    vi.clearAllMocks();
    provider = new FolderDriveProvider(fakeDotYouClient());
    uploadFile.mockResolvedValue({ file: { fileId: 'f1' }, newVersionTag: 'v2' });
    patchFile.mockResolvedValue({ newVersionTag: 'v2' });
});

describe('FolderDriveProvider card payload', () => {
    it('a patch (rename) uploads the new card payload', async () => {
        getFileHeader.mockResolvedValue(header(false));
        const image = new Blob(['png']);
        await provider.updateFolder('f1', 'v1', folder(true, { card }), image);
        expect(patchFile.mock.calls[0][4]).toEqual([{ key: PAYLOAD_KEY_CARD_IMAGE, payload: image }]);
    });

    it('unshare keeps the existing card payload and content', async () => {
        getFileHeader.mockResolvedValue(header(false));
        getPayloadBytes.mockResolvedValue({ bytes: new Uint8Array([1, 2]), contentType: 'image/webp' });
        await provider.updateFolder('f1', 'v1', folder(false));
        expect(patchFile).not.toHaveBeenCalled();
        const [, , meta, payloads] = uploadFile.mock.calls[0];
        expect(payloads).toHaveLength(1);
        expect(payloads[0].key).toBe(PAYLOAD_KEY_CARD_IMAGE);
        expect(JSON.parse(meta.appData.content).card).toEqual(card);
    });

    it('drops card from the content when its payload is gone', async () => {
        getFileHeader.mockResolvedValue(header(false, false));
        await provider.updateFolder('f1', 'v1', folder(false));
        const [, , meta, payloads] = uploadFile.mock.calls[0];
        expect(payloads).toEqual([]);
        const content = JSON.parse(meta.appData.content);
        expect(content.card).toBeUndefined();
        expect(content.color).toBe('red');
    });

    it('a new card replaces the old on re-upload', async () => {
        getFileHeader.mockResolvedValue(header(false));
        const image = new Blob(['new']);
        const next = { cardImageKey: PAYLOAD_KEY_CARD_IMAGE, from: { name: 'Trips', count: 3 } };
        await provider.updateFolder('f1', 'v1', folder(false, { card: next }), image);
        const [, , meta, payloads] = uploadFile.mock.calls[0];
        expect(payloads).toEqual([{ key: PAYLOAD_KEY_CARD_IMAGE, payload: image }]);
        expect(JSON.parse(meta.appData.content).card).toEqual(next);
        expect(getPayloadBytes).not.toHaveBeenCalled();
    });
});
