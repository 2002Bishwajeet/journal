/**
 * #176: every inserted photo should land at most 2560px on its long edge with
 * EXIF stripped and orientation applied; HEIC works where the browser can
 * decode it. `planImageIngest` is pure (no DOM APIs) so it's tested directly;
 * `prepareImageForUpload` drives `createImageBitmap`/canvas, which this
 * environment doesn't implement, so those are mocked as globals.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    planImageIngest,
    scaleToMaxEdge,
    prepareImageForUpload,
    UnsupportedImageError,
    MAX_EDGE,
    QUALITY,
} from '@/lib/images/imageIngest';

describe('planImageIngest', () => {
    it('keeps GIFs untouched to preserve animation, regardless of size', () => {
        expect(planImageIngest({ type: 'image/gif', size: 50 * 1024 * 1024, width: 5000, height: 5000 }).action)
            .toBe('keep');
    });

    it.each(['image/jpeg', 'image/heic', 'image/heif'])(
        'always re-encodes a small %s to JPEG, to strip EXIF',
        (type) => {
            const plan = planImageIngest({ type, size: 500 * 1024, width: 800, height: 600 });
            expect(plan).toEqual({ action: 'reencode', outType: 'image/jpeg', maxEdge: MAX_EDGE, quality: QUALITY });
        },
    );

    it('keeps a small PNG untouched', () => {
        const plan = planImageIngest({ type: 'image/png', size: 500 * 1024, width: 800, height: 600 });
        expect(plan.action).toBe('keep');
    });

    it('re-encodes a PNG whose long edge exceeds the cap', () => {
        const plan = planImageIngest({ type: 'image/png', size: 500 * 1024, width: 4000, height: 3000 });
        expect(plan).toEqual({ action: 'reencode', outType: 'image/png', maxEdge: MAX_EDGE, quality: QUALITY });
    });

    it('re-encodes a small-dimension WebP that is over 2 MB', () => {
        const plan = planImageIngest({ type: 'image/webp', size: 3 * 1024 * 1024, width: 800, height: 600 });
        expect(plan).toEqual({ action: 'reencode', outType: 'image/png', maxEdge: MAX_EDGE, quality: QUALITY });
    });

    it('does not re-encode a PNG exactly at the cap', () => {
        const plan = planImageIngest({ type: 'image/png', size: 1024, width: MAX_EDGE, height: 1000 });
        expect(plan.action).toBe('keep');
    });
});

describe('scaleToMaxEdge', () => {
    it('leaves dimensions unchanged when already within the cap', () => {
        expect(scaleToMaxEdge(1200, 800, MAX_EDGE)).toEqual({ width: 1200, height: 800 });
    });

    it('downscales the long edge to the cap, preserving aspect ratio', () => {
        expect(scaleToMaxEdge(5120, 2560, MAX_EDGE)).toEqual({ width: 2560, height: 1280 });
    });

    it('never upscales', () => {
        expect(scaleToMaxEdge(100, 50, MAX_EDGE)).toEqual({ width: 100, height: 50 });
    });
});

describe('prepareImageForUpload', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubDecode(width: number, height: number) {
        const close = vi.fn();
        vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close }) as unknown as ImageBitmap));
        return close;
    }

    function stubOffscreenCanvas(outBlob: Blob) {
        const convertToBlob = vi.fn(async () => outBlob);
        const drawImage = vi.fn();
        class FakeOffscreenCanvas {
            width: number;
            height: number;
            convertToBlob = convertToBlob;
            constructor(width: number, height: number) {
                this.width = width;
                this.height = height;
            }
            getContext() {
                return { drawImage };
            }
        }
        vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
        return { convertToBlob, drawImage };
    }

    it('returns a GIF untouched without decoding it', async () => {
        const decode = vi.fn();
        vi.stubGlobal('createImageBitmap', decode);
        const file = new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' });

        const result = await prepareImageForUpload(file);

        expect(result).toBe(file);
        expect(decode).not.toHaveBeenCalled();
    });

    it('returns the original file untouched when the plan says keep', async () => {
        const close = stubDecode(800, 600);
        const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });

        const result = await prepareImageForUpload(file);

        expect(result).toBe(file);
        expect(close).toHaveBeenCalled();
    });

    it('re-encodes a JPEG at the planned quality and keeps the .jpg extension', async () => {
        stubDecode(800, 600);
        const outBlob = new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' });
        const { convertToBlob, drawImage } = stubOffscreenCanvas(outBlob);
        const file = new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' });

        const result = await prepareImageForUpload(file);

        expect(result).not.toBe(file);
        expect(result.name).toBe('photo.jpg');
        expect(result.type).toBe('image/jpeg');
        expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
        expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: QUALITY });
    });

    it('downscales a HEIC photo, re-encoding it to .jpg', async () => {
        stubDecode(5120, 2560);
        const outBlob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
        const { drawImage } = stubOffscreenCanvas(outBlob);
        const file = new File([new Uint8Array([1])], 'IMG_0001.heic', { type: 'image/heic' });

        const result = await prepareImageForUpload(file);

        expect(result.name).toBe('IMG_0001.jpg');
        expect(result.type).toBe('image/jpeg');
        expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 1280);
    });

    it('throws UnsupportedImageError when the browser cannot decode HEIC', async () => {
        vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('no HEIC decoder'); }));
        const file = new File([new Uint8Array([1])], 'a.heic', { type: 'image/heic' });

        await expect(prepareImageForUpload(file)).rejects.toBeInstanceOf(UnsupportedImageError);
    });

    it('rethrows a non-HEIC decode failure unchanged', async () => {
        const boom = new Error('corrupt image');
        vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw boom; }));
        const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });

        await expect(prepareImageForUpload(file)).rejects.toBe(boom);
    });
});
