import { describe, it, expect } from 'vitest';
import { imageFilename } from '@/lib/images/imageDownload';
import { FIT, MAX_SCALE, toggleZoom, zoomAt } from '@/lib/images/zoomPan';

describe('zoomAt', () => {
    it('zooms to at least 4x and caps at the maximum', () => {
        let v = FIT;
        for (let i = 0; i < 10; i++) v = zoomAt(v, 1.5, 0, 0);
        expect(MAX_SCALE).toBeGreaterThanOrEqual(4);
        expect(v.scale).toBe(MAX_SCALE);
    });

    it('keeps the point under the cursor fixed', () => {
        const v = zoomAt(FIT, 2, 100, 50);
        expect((100 - v.x) / v.scale).toBeCloseTo(100);
        expect((50 - v.y) / v.scale).toBeCloseTo(50);
    });

    it('snaps back to fit with no pan when zoomed out fully', () => {
        const zoomed = zoomAt(FIT, 3, 40, 40);
        expect(zoomAt(zoomed, 0.1, 40, 40)).toEqual(FIT);
    });
});

describe('toggleZoom', () => {
    it('goes to natural size, then back to fit', () => {
        const zoomed = toggleZoom(FIT, 3, 0, 0);
        expect(zoomed.scale).toBe(3);
        expect(toggleZoom(zoomed, 3, 0, 0)).toEqual(FIT);
    });

    it('still zooms when the image already shows at natural size', () => {
        expect(toggleZoom(FIT, 1, 0, 0).scale).toBe(2);
    });
});

describe('imageFilename', () => {
    it('slugs the alt text and picks the extension from the content type', () => {
        expect(imageFilename('My Cat, sleeping!', 'image/jpeg')).toBe('my-cat-sleeping.jpg');
    });

    it('falls back to "image" and png', () => {
        expect(imageFilename('  ', '')).toBe('image.png');
    });
});
