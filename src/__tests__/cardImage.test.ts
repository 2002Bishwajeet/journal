/**
 * #441: the link-card image is 1200×630. A wide banner cover is shown whole (no side
 * crop) over a blurred fill of itself; a cover up to 1.91:1 fills the card and is cropped
 * vertically at its positionY, the same crop as the editor band.
 */
import { describe, it, expect } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, cardLayout } from '@/lib/share/cardImage';

const FULL_CARD = { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT };

describe('cardLayout', () => {
    it('shows a wide 3:1 banner whole, centred, over a blurred background', () => {
        const layout = cardLayout(3000, 1000, 50);

        expect(layout.source).toEqual({ x: 0, y: 0, width: 3000, height: 1000 });
        expect(layout.dest).toEqual({ x: 0, y: 115, width: 1200, height: 400 });
        // The background fills the card: a centred 1.905:1 crop of the banner.
        expect(layout.background?.height).toBe(1000);
        expect(layout.background?.width).toBeCloseTo(1904.76, 1);
        expect(layout.background?.x).toBeCloseTo((3000 - 1904.76) / 2, 1);
    });

    it.each([
        [0, 0],
        [50, 350],
        [100, 700],
    ])('crops a tall cover at positionY %i (source y %i), like the editor band', (positionY, y) => {
        // 1200×1330 at 1× scale: 630 of its 1330 rows are visible.
        const layout = cardLayout(1200, 1330, positionY);

        expect(layout.background).toBeUndefined();
        expect(layout.dest).toEqual(FULL_CARD);
        expect(layout.source).toEqual({ x: 0, y, width: 1200, height: 630 });
    });

    it('scales a tall cover to the card width before cropping', () => {
        const layout = cardLayout(600, 1000, 100);

        expect(layout.source.width).toBe(600);
        expect(layout.source.height).toBeCloseTo(315);
        expect(layout.source.y).toBeCloseTo(1000 - 315);
    });

    it.each([
        ['1200×630', 2400, 1260],
        ['1.91:1', 1910, 1000],
    ])('fills an exact %s cover with no letterbox', (_label, width, height) => {
        const layout = cardLayout(width, height, 50);

        expect(layout.background).toBeUndefined();
        expect(layout.dest).toEqual(FULL_CARD);
        expect(layout.source.height).toBeCloseTo(height);
        // At most a sliver of the sides is cropped.
        expect(layout.source.width / width).toBeGreaterThan(0.99);
    });
});
