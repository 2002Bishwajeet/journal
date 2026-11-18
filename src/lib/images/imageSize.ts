/**
 * Reserving an image's box before its bytes arrive (#1387). The image node stores its
 * pixel size (`naturalWidth` / `naturalHeight`, written as `data-width` / `data-height`
 * in HTML and markdown), apart from the drag-resized `width`. Notes from before that get
 * a size from the note file's payload descriptors (its largest thumbnail), then from the
 * first load.
 */
import type { CSSProperties } from 'react';
import type { EmbeddedThumb, ImageSize, PayloadDescriptor } from '@homebase-id/js-lib/core';
import { editedSize, type ImageEdits, type Size } from './imageEdits';

/** A positive whole number, or undefined (an attribute may be a string, or missing). */
function pixels(value: unknown): number | undefined {
    const n = typeof value === 'string' ? parseInt(value, 10) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** The size stored on an image node (or read from its `data-width` / `data-height`), if both sides are valid. */
export function readNaturalSize(attrs: { naturalWidth?: unknown; naturalHeight?: unknown }): Size | undefined {
    const width = pixels(attrs.naturalWidth);
    const height = pixels(attrs.naturalHeight);
    return width && height ? { width, height } : undefined;
}

/** Node attrs for a size; `null` clears them. */
export function naturalSizeAttrs(size?: Size | null): { naturalWidth: number | null; naturalHeight: number | null } {
    const valid = size && readNaturalSize({ naturalWidth: size.width, naturalHeight: size.height });
    return { naturalWidth: valid ? valid.width : null, naturalHeight: valid ? valid.height : null };
}

/**
 * What to write onto a node that has no stored size (the one backfill write, in the
 * editor): the payload descriptor's size when the header has it, else the first loaded
 * image's. Null when the node already has one, or nothing is known yet.
 */
export function sizeToBackfill({ stored, fromHeader, loaded }: { stored?: Size; fromHeader?: Size; loaded?: Size }): Size | null {
    if (stored) return null;
    return fromHeader ?? loaded ?? null;
}

/** The pixel size of an image file, or undefined when the browser can't decode it. */
export async function measureImage(file: Blob): Promise<Size | undefined> {
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    } catch {
        return undefined;
    }
}

/** What the note file's header says about one image payload. */
export interface PayloadPreview {
    /** The tiny embedded thumbnail, shown blurred until the image loads. */
    thumb?: EmbeddedThumb;
    /** The largest thumbnail's size: the image's own when it is under the thumbnail cap. */
    size?: Size;
    /** Every thumbnail size, so the loader can pick the smallest that fills the box. */
    sizes?: ImageSize[];
}

/** The previews of a note file's image payloads, by payload key. */
export function payloadPreviews(
    payloads: Pick<PayloadDescriptor, 'key' | 'previewThumbnail' | 'thumbnails'>[] | undefined,
): Record<string, PayloadPreview> {
    const out: Record<string, PayloadPreview> = {};
    for (const { key, previewThumbnail, thumbnails } of payloads ?? []) {
        const sizes = thumbnails?.map(({ pixelWidth, pixelHeight }) => ({ pixelWidth, pixelHeight }));
        const largest = sizes?.reduce<ImageSize | undefined>(
            (max, s) => (!max || s.pixelWidth * s.pixelHeight > max.pixelWidth * max.pixelHeight ? s : max),
            undefined,
        );
        if (!previewThumbnail && !largest) continue;
        out[key] = {
            thumb: previewThumbnail,
            size: largest && { width: largest.pixelWidth, height: largest.pixelHeight },
            sizes,
        };
    }
    return out;
}

/** A tiny embedded thumbnail as an <img> src. */
export const thumbSrc = (thumb: EmbeddedThumb) => `data:${thumb.contentType};base64,${thumb.content}`;

/** CSS `aspect-ratio` of the box an image of `size` shows in, with its crop and turn (#584). */
export function boxAspect(size: Size, edits?: ImageEdits): CSSProperties['aspectRatio'] {
    const box = edits ? editedSize(size, edits) : size;
    return `${box.width} / ${box.height}`;
}
