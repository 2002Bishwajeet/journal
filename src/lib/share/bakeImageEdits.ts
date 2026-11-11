/**
 * Bakes an image's non-destructive edits (#584) into its pixels for the feed (#1074).
 *
 * In Journal crop, rotate and flip are CSS over the original bytes. A feed post serves its
 * payloads by URL, so the original would stay reachable there and a crop that hid a face would
 * not really hide it. This draws the edited box to a canvas (crop, then rotate, then flip, as
 * `editLayers` shows it) and re-encodes it, which also drops EXIF and GPS.
 */
import { editedSize, FULL_CROP, hasEdits, type ImageEdits } from '@/lib/images/imageEdits';
import { canvasToBlob, makeCanvas } from '@/lib/images/imageIngest';

const JPEG_QUALITY = 0.92;

// Kept as they are when unedited (animation, vectors); every other type is re-encoded, so no
// EXIF or GPS goes out with it.
const KEEP_TYPES = ['image/gif', 'image/svg+xml'];
// Under iOS Safari's canvas limit (16,777,216 pixels); larger images are scaled down to fit.
export const MAX_PIXELS = 16_000_000;

function hasTransparency(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, width: number, height: number): boolean {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
}

/** The image with `edits` drawn in, re-encoded: PNG for a PNG (or a WebP or GIF with transparency), else JPEG. */
export async function bakeImageEdits(image: Blob, edits: ImageEdits): Promise<Blob> {
    if (!hasEdits(edits) && KEEP_TYPES.includes(image.type)) return image;

    const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
    try {
        const natural = { width: bitmap.width, height: bitmap.height };
        const crop = edits.crop ?? FULL_CROP;
        const sw = natural.width * crop.w;
        const sh = natural.height * crop.h;
        const box = editedSize(natural, edits);
        const fit = Math.min(1, Math.sqrt(MAX_PIXELS / (box.width * box.height)));
        const width = Math.max(1, Math.round(box.width * fit));
        const height = Math.max(1, Math.round(box.height * fit));

        const canvas = makeCanvas(width, height);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
        if (!ctx) throw new Error('2D canvas context unavailable');
        // Applied right to left, as in editLayers: turn the crop, mirror it on screen, centre it.
        ctx.translate(width / 2, height / 2);
        ctx.scale(edits.flipH ? -fit : fit, edits.flipV ? -fit : fit);
        ctx.rotate((edits.rotate * Math.PI) / 180);
        ctx.drawImage(bitmap, natural.width * crop.x, natural.height * crop.y, sw, sh, -sw / 2, -sh / 2, sw, sh);

        const png = image.type === 'image/png'
            || ((image.type === 'image/webp' || image.type === 'image/gif') && hasTransparency(ctx, width, height));
        const type = png ? 'image/png' : 'image/jpeg';
        return await canvasToBlob(canvas, type, JPEG_QUALITY);
    } finally {
        bitmap.close();
    }
}
