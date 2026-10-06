/** #444: OdinImage sizes its request from device pixels, not CSS pixels. */
import { describe, it, expect } from 'vitest';
import { pickLoadSize } from '@/components/OdinImage/pickLoadSize';

const size = (pixelWidth: number, pixelHeight: number) => ({ pixelWidth, pixelHeight });
const thumbs = [size(320, 180), size(640, 360), size(1080, 608), size(1600, 900)];
const withNatural = [...thumbs, size(2560, 1440)];

describe('pickLoadSize', () => {
    it('picks a thumb that covers the box in device pixels', () => {
        expect(pickLoadSize({ sizes: thumbs, cssWidth: 400, cssHeight: 210, dpr: 2 })).toEqual(size(1080, 608));
        expect(pickLoadSize({ sizes: thumbs, cssWidth: 400, cssHeight: 210, dpr: 1 })).toEqual(size(640, 360));
    });

    it('rounds a fractional dpr up', () => {
        expect(pickLoadSize({ sizes: thumbs, cssWidth: 400, cssHeight: 210, dpr: 1.25 })).toEqual(size(1080, 608));
    });

    it('loads the payload when the box needs more pixels than the largest thumb', () => {
        expect(pickLoadSize({ sizes: withNatural, cssWidth: 1600, cssHeight: 224, dpr: 2 })).toBe('full');
    });

    it('keeps the natural-size thumb at dpr 1', () => {
        expect(pickLoadSize({ sizes: withNatural, cssWidth: 1600, cssHeight: 224, dpr: 1 })).toEqual(size(2560, 1440));
    });

    it('never loads the payload when avoidPayload is set', () => {
        const picked = pickLoadSize({ sizes: withNatural, cssWidth: 1600, cssHeight: 224, dpr: 2, avoidPayload: true });
        expect(picked).toEqual(size(2560, 1440));
    });

    it('fetches nothing for a box with no width or height', () => {
        expect(pickLoadSize({ sizes: thumbs, cssWidth: 0, cssHeight: 210, dpr: 2 })).toBeUndefined();
        expect(pickLoadSize({ sizes: thumbs, cssWidth: 400, cssHeight: 0, dpr: 2 })).toBeUndefined();
    });

    it('requests the box size when the thumb list is unknown, keeping the natural aspect ratio', () => {
        expect(pickLoadSize({ sizes: undefined, cssWidth: 400, cssHeight: 210, dpr: 2 })).toEqual(size(800, 420));
        expect(
            pickLoadSize({ sizes: undefined, cssWidth: 400, cssHeight: 210, dpr: 2, naturalSize: size(1000, 500) }),
        ).toEqual(size(800, 400));
    });
});
