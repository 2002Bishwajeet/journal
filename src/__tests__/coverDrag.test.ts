import { describe, it, expect } from 'vitest';
import { dragToPositionY } from '@/lib/editor/cover';

describe('dragToPositionY', () => {
    it('dragging down by the full band height moves the focal point to the top', () => {
        expect(dragToPositionY(50, 200, 200)).toBe(0);
    });

    it('dragging up moves the focal point towards the bottom', () => {
        expect(dragToPositionY(50, -200, 200)).toBe(100);
        expect(dragToPositionY(50, -50, 200)).toBe(75);
    });

    it('does not move without a drag', () => {
        expect(dragToPositionY(30, 0, 200)).toBe(30);
    });

    it('clamps to 0–100 and rounds', () => {
        expect(dragToPositionY(10, 400, 200)).toBe(0);
        expect(dragToPositionY(90, -400, 200)).toBe(100);
        expect(dragToPositionY(50, 1, 3)).toBe(17);
    });

    it('keeps the start position when the band has no height yet', () => {
        expect(dragToPositionY(40, 25, 0)).toBe(40);
    });
});
