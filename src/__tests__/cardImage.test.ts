/**
 * #441: the link-card image is 1200×630. A wide banner cover is shown whole (no side
 * crop) over a blurred fill of itself; a cover up to 1.91:1 fills the card and is cropped
 * vertically at its positionY, the same crop as the editor band.
 */
import { describe, it, expect } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, cardLayout, wrapText } from '@/lib/share/cardImage';

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

/**
 * #434: the card's title wraps to 3 lines and its excerpt to 2, then ends with an
 * ellipsis; no line is ever wider than the text box. Measured here as 10px per character.
 */
describe('wrapText', () => {
    const measure = (s: string) => s.length * 10;
    const fits = (lines: string[], maxWidth: number) => lines.every((line) => measure(line) <= maxWidth);

    it('keeps a short title on one line', () => {
        expect(wrapText('A short title', 200, 3, measure)).toEqual(['A short title']);
    });

    it('wraps at spaces, collapsing whitespace', () => {
        expect(wrapText('alpha  beta\ngamma delta', 110, 3, measure)).toEqual(['alpha beta', 'gamma delta']);
    });

    it('ends the last line with an ellipsis when the text needs more lines', () => {
        const lines = wrapText('one two three four five six seven eight nine ten', 100, 3, measure);

        expect(lines).toEqual(['one two', 'three four', 'five six…']);
        expect(fits(lines, 100)).toBe(true);
    });

    it('cuts the last line back so the ellipsis fits', () => {
        const lines = wrapText('aaaa bbbb cccc dddd eeee', 90, 2, measure);

        expect(lines).toEqual(['aaaa bbbb', 'cccc ddd…']);
        expect(fits(lines, 90)).toBe(true);
    });

    it('breaks a word wider than a line between characters', () => {
        const lines = wrapText('Supercalifragilistic is long', 80, 3, measure);

        expect(lines).toEqual(['Supercal', 'ifragili', 'stic is…']);
        expect(fits(lines, 80)).toBe(true);
    });

    it('never splits a surrogate pair', () => {
        const lines = wrapText('😀😀😀😀', 20, 3, (s) => Array.from(s).length * 10);

        expect(lines).toEqual(['😀😀', '😀😀']);
    });

    it('returns no lines for blank text', () => {
        expect(wrapText('   ', 100, 3, measure)).toEqual([]);
    });
});
