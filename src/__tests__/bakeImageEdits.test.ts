/**
 * #1074: publishing to the feed bakes crop, rotate and flip into the image bytes, so the
 * original never reaches the post. Node has no canvas, so a small software 2D context stands in:
 * it applies the same affine transforms a browser canvas does and samples the source per pixel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bakeImageEdits, MAX_PIXELS } from '@/lib/share/bakeImageEdits';
import { NO_EDITS, type ImageEdits } from '@/lib/images/imageEdits';

type Matrix = [number, number, number, number, number, number];
const multiply = ([a, b, c, d, e, f]: Matrix, [a2, b2, c2, d2, e2, f2]: Matrix): Matrix => [
    a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f,
];

/** A decoded image: one id per pixel (row-major), and an alpha per pixel. */
interface FakeBitmap { width: number; height: number; px: number[]; alpha: number[]; close: () => void }

class FakeContext {
    m: Matrix = [1, 0, 0, 1, 0, 0];
    out: number[];
    alpha: number[];
    canvas: FakeCanvas;
    constructor(canvas: FakeCanvas) {
        this.canvas = canvas;
        this.out = new Array(canvas.width * canvas.height).fill(-1);
        this.alpha = new Array(canvas.width * canvas.height).fill(0);
    }
    translate(x: number, y: number) { this.m = multiply(this.m, [1, 0, 0, 1, x, y]); }
    scale(x: number, y: number) { this.m = multiply(this.m, [x, 0, 0, y, 0, 0]); }
    rotate(r: number) { this.m = multiply(this.m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]); }
    drawImage(img: FakeBitmap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
        const [a, b, c, d, e, f] = this.m;
        const det = a * d - b * c;
        for (let j = 0; j < this.canvas.height; j++) {
            for (let i = 0; i < this.canvas.width; i++) {
                const X = i + 0.5 - e;
                const Y = j + 0.5 - f;
                const u = (d * X - c * Y) / det;
                const v = (-b * X + a * Y) / det;
                if (u < dx || u >= dx + dw || v < dy || v >= dy + dh) continue;
                const x = Math.floor(sx + ((u - dx) * sw) / dw);
                const y = Math.floor(sy + ((v - dy) * sh) / dh);
                this.out[j * this.canvas.width + i] = img.px[y * img.width + x];
                this.alpha[j * this.canvas.width + i] = img.alpha[y * img.width + x];
            }
        }
    }
    getImageData(_x: number, _y: number, w: number, h: number) {
        const data = new Uint8ClampedArray(w * h * 4);
        this.alpha.forEach((a, i) => (data[i * 4 + 3] = a));
        return { data };
    }
}

class FakeCanvas {
    width: number;
    height: number;
    ctx: FakeContext;
    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.ctx = new FakeContext(this);
    }
    getContext() { return this.ctx; }
    // What the encoder writes: the pixels only, never the source's bytes or metadata
    async convertToBlob({ type }: { type: string }) {
        return new Blob([JSON.stringify({ width: this.width, height: this.height, px: this.ctx.out })], { type });
    }
}

let decoded: FakeBitmap;
const bitmap = (width: number, height: number, alpha = 255): FakeBitmap => ({
    width, height, px: Array.from({ length: width * height }, (_, i) => i), alpha: new Array(width * height).fill(alpha), close: vi.fn(),
});
const decode = async (blob: Blob) => JSON.parse(await blob.text()) as { width: number; height: number; px: number[] };
const edits = (over: Partial<ImageEdits>): ImageEdits => ({ ...NO_EDITS, ...over });

beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => decoded));
});
afterEach(() => vi.unstubAllGlobals());

describe('bakeImageEdits', () => {
    it('crops, then turns a quarter, then mirrors, as the editor shows it', async () => {
        // 4x2 source, ids 0..7; crop the left three columns (3x2), turn right, flip horizontally
        decoded = bitmap(4, 2);
        const out = await bakeImageEdits(
            new Blob(['src'], { type: 'image/png' }),
            edits({ crop: { x: 0, y: 0, w: 0.75, h: 1 }, rotate: 90, flipH: true }),
        );

        const { width, height, px } = await decode(out);
        expect({ width, height }).toEqual({ width: 2, height: 3 });
        // Turned right:  4 0 / 5 1 / 6 2 ; then mirrored:  0 4 / 1 5 / 2 6
        expect(px).toEqual([0, 4, 1, 5, 2, 6]);
        expect(px).not.toContain(3);
        expect(px).not.toContain(7);
    });

    it('keeps every pixel of an unedited image', async () => {
        decoded = bitmap(3, 2);
        const out = await bakeImageEdits(new Blob(['src'], { type: 'image/png' }), NO_EDITS);

        expect(out.type).toBe('image/png');
        expect(await decode(out)).toEqual({ width: 3, height: 2, px: [0, 1, 2, 3, 4, 5] });
    });

    it('re-encodes a JPEG, so its EXIF and GPS are not in the output', async () => {
        decoded = bitmap(2, 2);
        const exifJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xd9]);
        const out = await bakeImageEdits(new Blob([exifJpeg], { type: 'image/jpeg' }), NO_EDITS);

        const bytes = new Uint8Array(await out.arrayBuffer());
        expect(out.type).toBe('image/jpeg');
        expect(new TextDecoder().decode(bytes)).not.toContain('Exif');
        expect(bytes.includes(0xe1)).toBe(false);
    });

    it('writes a PNG for a WebP with transparency and a JPEG for an opaque one', async () => {
        decoded = bitmap(2, 2, 128);
        expect((await bakeImageEdits(new Blob(['src'], { type: 'image/webp' }), edits({ rotate: 180 }))).type).toBe('image/png');
        decoded = bitmap(2, 2);
        expect((await bakeImageEdits(new Blob(['src'], { type: 'image/webp' }), edits({ rotate: 180 }))).type).toBe('image/jpeg');
    });

    it('re-encodes an unedited AVIF too, as any raster type can carry EXIF', async () => {
        decoded = bitmap(2, 2);
        const avif = new Blob(['avif-with-exif'], { type: 'image/avif' });
        const out = await bakeImageEdits(avif, NO_EDITS);

        expect(out).not.toBe(avif);
        expect(out.type).toBe('image/jpeg');
    });

    it('scales an image past the canvas limit down to fit it', async () => {
        // A canvas that only records its size: a real-size fake would allocate millions of pixels
        let size = { width: 0, height: 0 };
        vi.stubGlobal('OffscreenCanvas', class {
            constructor(width: number, height: number) { size = { width, height }; }
            getContext() { return { translate() {}, scale() {}, rotate() {}, drawImage() {} }; }
            async convertToBlob({ type }: { type: string }) { return new Blob([], { type }); }
        });
        decoded = { ...bitmap(1, 1), width: 8000, height: 6000 };
        await bakeImageEdits(new Blob(['src'], { type: 'image/jpeg' }), NO_EDITS);

        // MAX_PIXELS before rounding, so within a row of it; always under iOS Safari's limit
        expect(size.width * size.height).toBeLessThan(MAX_PIXELS * 1.001);
        expect(size.width * size.height).toBeLessThan(16_777_216);
        expect(size.width / size.height).toBeCloseTo(8000 / 6000, 2);
    });

    it('keeps an unedited GIF as it is, for its animation', async () => {
        const gif = new Blob(['gif'], { type: 'image/gif' });
        expect(await bakeImageEdits(gif, NO_EDITS)).toBe(gif);
        expect(createImageBitmap).not.toHaveBeenCalled();
    });
});
