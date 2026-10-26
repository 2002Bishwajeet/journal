import type { EmbeddedThumb, ImageSize, PayloadFile, ThumbnailFile } from '@homebase-id/js-lib/core';
import { getRandom16ByteArray } from '@homebase-id/js-lib/helpers';
import { createThumbnails } from '@homebase-id/js-lib/media';
import { dedupeThumbnailsByDimensions } from '@/lib/utils';
import { PAYLOAD_KEY_CONTENT } from './config';

const YJS_MIME_TYPE = 'application/yjs';

/**
 * Homebase refuses an upload with a thumbnail over 1 MiB ("ThumbnailDescriptor
 * BytesWritten ... too long"). The margin covers encryption padding.
 */
export const MAX_THUMBNAIL_BYTES = 1024 * 1024 - 4096;

const fitsServerLimit = (thumb: ThumbnailFile) => thumb.payload.size <= MAX_THUMBNAIL_BYTES;

/** Homebase refuses an embedded preview over 1 KiB (ThumbnailContent.MaxTinyThumbLength). */
export const MAX_PREVIEW_BYTES = 1024;

const previewBytes = (thumb: EmbeddedThumb) =>
    Math.floor((thumb.content.length * 3) / 4) - (thumb.content.match(/=+$/)?.[0].length ?? 0);

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
        return { payload, thumbnails: [{ key: payloadKey, ...naturalSize, payload: file }].filter(fitsServerLimit) };
    }

    // A thumbnail that can't be drawn (e.g. an image this browser can't decode) must not
    // block the upload: the image goes up without thumbnails
    const thumbs = await createThumbnails(file, payloadKey).catch((error: unknown) => {
        console.warn(`[noteImagePayloads] no thumbnails for ${payloadKey}:`, error);
        return undefined;
    });
    if (!thumbs) return { payload, thumbnails: [] };
    const { additionalThumbnails, tinyThumb } = thumbs;
    return {
        payload: { ...payload, previewThumbnail: previewBytes(tinyThumb) <= MAX_PREVIEW_BYTES ? tinyThumb : undefined },
        // A thumbnail over the limit would fail the whole upload; the smaller ones still serve
        thumbnails: dedupeThumbnailsByDimensions(additionalThumbnails.filter(fitsServerLimit)),
    };
}
