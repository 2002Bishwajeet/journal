import { describe, it, expect } from 'vitest';
import { SWIPE_CLOSE_DISTANCE, swipeCloses } from '@/lib/images/zoomPan';

// #829: a swipe at fit closes the full-screen viewer past a distance, or on a flick.
describe('swipeCloses', () => {
    it('springs back from a short, slow drag', () => {
        expect(swipeCloses(40, 0)).toBe(false);
        expect(swipeCloses(SWIPE_CLOSE_DISTANCE - 1, 0.1)).toBe(false);
    });

    it('closes past the distance, down or up', () => {
        expect(swipeCloses(200, 0)).toBe(true);
        expect(swipeCloses(-SWIPE_CLOSE_DISTANCE, 0)).toBe(true);
    });

    it('closes on a fast flick that has moved a little', () => {
        expect(swipeCloses(40, 0.8)).toBe(true);
        expect(swipeCloses(-40, -0.8)).toBe(true);
    });

    it('ignores a twitch, however fast', () => {
        expect(swipeCloses(5, 2)).toBe(false);
    });
});
