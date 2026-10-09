import type { ImageSize, PayloadFile, ThumbnailFile } from '@homebase-id/js-lib/core';
import { getRandom16ByteArray } from '@homebase-id/js-lib/helpers';
import { createThumbnails } from '@homebase-id/js-lib/media';
import { dedupeThumbnailsByDimensions } from '@/lib/utils';
import { PAYLOAD_KEY_CONTENT } from './config';

const YJS_MIME_TYPE = 'application/yjs';

/**
 * The note's Yjs content payload, when there is content. Only an encrypted note's
 * payload gets an IV: the server rejects a payload IV (invalidUpload) when the
 * file header isn't encrypted.
 */
export function buildContentPayloads(yjsBlob: Uint8Array | undefined, isEncrypted: boolean): PayloadFile[] {
    if (!yjsBlob || yjsBlob.length === 0) return [];
    return [{
        key: PAYLOAD_KEY_CONTENT,
        payload: new Blob([new Uint8Array(yjsBlob)], { type: YJS_MIME_TYPE }),
        iv: isEncrypted ? getRandom16ByteArray() : undefined,
    }];
}

/**
 * Build a note image payload under `payloadKey`, with a preview thumbnail and
 * thumbnails when the file is an image. `iv` is set only for an encrypted note.
 * With `naturalSize` (where there is no canvas to draw thumbnails, as in the MCP
 * server) the image itself is its one thumbnail, so thumb requests still resolve.
 */
export async function buildImagePayload(
    file: Blob,
    filename: string | undefined,
    payloadKey: string,
    iv?: Uint8Array,
    naturalSize?: ImageSize
): Promise<{ payload: PayloadFile; thumbnails: ThumbnailFile[] }> {
    const payload: PayloadFile = {
        key: payloadKey,
        iv,
        payload: file,
        descriptorContent: filename || file.type,
    };
    if (!file.type.startsWith('image/')) {
        return { payload, thumbnails: [] };
    }
    if (naturalSize) {
        return { payload, thumbnails: [{ key: payloadKey, ...naturalSize, payload: file }] };
    }

    const { additionalThumbnails, tinyThumb } = await createThumbnails(file, payloadKey);
    return {
        payload: { ...payload, previewThumbnail: tinyThumb },
        thumbnails: dedupeThumbnailsByDimensions(additionalThumbnails),
    };
}
