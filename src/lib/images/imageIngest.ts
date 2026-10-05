/**
 * Image ingest (#176): downscale, re-orient and strip EXIF before an image
 * ever reaches the pending-upload queue. `createImageBitmap(..., { imageOrientation:
 * 'from-image' })` bakes in EXIF orientation, and re-encoding via canvas drops
 * every other EXIF tag (GPS, device) along the way — no parsing needed.
 */

/** Thrown when the browser can't decode the source image (e.g. HEIC on non-Safari). */
export class UnsupportedImageError extends Error {
    constructor(message = "This browser can't read this image format") {
        super(message);
        this.name = 'UnsupportedImageError';
    }
}

export type ImageIngestAction = 'keep' | 'reencode';
export type ImageIngestOutType = 'image/jpeg' | 'image/png';

export interface ImageIngestInput {
    type: string;
    size: number;
    width: number;
    height: number;
    /** Re-encode PNG/WebP even when small, to strip EXIF (used for public-facing covers). */
    forceReencode?: boolean;
}

export interface ImageIngestPlan {
    action: ImageIngestAction;
    outType: ImageIngestOutType;
    maxEdge: number;
    quality: number;
}

export const MAX_EDGE = 2560;
export const QUALITY = 0.85;
// PNG/WebP only get re-encoded when they're actually big; small ones are left alone.
const PNG_WEBP_REENCODE_THRESHOLD_BYTES = 2 * 1024 * 1024;

/** Pure — no DOM APIs, so it needs no mocking to test. */
export function planImageIngest({ type, size, width, height, forceReencode }: ImageIngestInput): ImageIngestPlan {
    if (type === 'image/jpeg' || type === 'image/heic' || type === 'image/heif') {
        // Always re-encoded, even when already small, to strip EXIF (GPS, device).
        return { action: 'reencode', outType: 'image/jpeg', maxEdge: MAX_EDGE, quality: QUALITY };
    }

    if (type === 'image/png' || type === 'image/webp') {
        const longEdge = Math.max(width, height);
        const action = forceReencode || longEdge > MAX_EDGE || size > PNG_WEBP_REENCODE_THRESHOLD_BYTES ? 'reencode' : 'keep';
        // Not WebP: Safari's canvas.toBlob('image/webp') silently returns PNG.
        return { action, outType: 'image/png', maxEdge: MAX_EDGE, quality: QUALITY };
    }

    // Covers go out publicly: AVIF/TIFF/BMP etc. can carry EXIF too, so re-encode them.
    if (forceReencode && type !== 'image/gif') {
        return { action: 'reencode', outType: 'image/jpeg', maxEdge: MAX_EDGE, quality: QUALITY };
    }

    // image/gif (preserve animation) and anything else: leave untouched.
    return { action: 'keep', outType: 'image/png', maxEdge: MAX_EDGE, quality: QUALITY };
}

/** Pure sizing math: scales down to fit maxEdge, preserving aspect ratio, never upscales. */
export function scaleToMaxEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
    const longEdge = Math.max(width, height);
    if (longEdge <= maxEdge) return { width, height };
    const scale = maxEdge / longEdge;
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function withNewExtension(name: string, outType: ImageIngestOutType): string {
    const ext = outType === 'image/jpeg' ? 'jpg' : 'png';
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    return `${base}.${ext}`;
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

async function encodeToBlob(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    outType: ImageIngestOutType,
    quality: number,
): Promise<Blob> {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);

    // Duck-typed rather than `instanceof OffscreenCanvas`: that class may not exist as a
    // global at all on a browser without it, and referencing it directly would throw.
    if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: outType, quality });

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))),
            outType,
            quality,
        );
    });
}

/**
 * Downscales, re-orients and strips EXIF from `file`. GIFs pass through untouched
 * (animation). Small PNG/WebP pass through untouched. Everything else is decoded
 * with orientation baked in and re-encoded, which drops the remaining EXIF.
 * `forceReencode` also re-encodes small PNG/WebP so their EXIF is stripped too.
 */
export async function prepareImageForUpload(file: File, { forceReencode = false } = {}): Promise<File> {
    if (file.type === 'image/gif') return file;

    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (error) {
        if (file.type === 'image/heic' || file.type === 'image/heif') {
            throw new UnsupportedImageError();
        }
        throw error;
    }

    try {
        const plan = planImageIngest({
            type: file.type,
            size: file.size,
            width: bitmap.width,
            height: bitmap.height,
            forceReencode,
        });

        if (plan.action === 'keep') return file;

        const { width, height } = scaleToMaxEdge(bitmap.width, bitmap.height, plan.maxEdge);
        const blob = await encodeToBlob(bitmap, width, height, plan.outType, plan.quality);
        return new File([blob], withNewExtension(file.name, plan.outType), { type: plan.outType });
    } finally {
        bitmap.close();
    }
}
