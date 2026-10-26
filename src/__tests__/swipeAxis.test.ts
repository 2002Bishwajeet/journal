import { describe, it, expect } from 'vitest';
import { swipeAxis } from '@/helpers/swipeAxis';

describe('swipeAxis', () => {
  it('should stay undecided until the finger moved 10px', () => {
    expect(swipeAxis(0, 0)).toBeNull();
    expect(swipeAxis(-9, 4)).toBeNull();
    expect(swipeAxis(3, 9.9)).toBeNull();
  });

  it('should read a mostly horizontal move as a swipe, in either direction', () => {
    expect(swipeAxis(-12, 3)).toBe('x');
    expect(swipeAxis(40, -10)).toBe('x');
  });

  it('should read a mostly vertical move as a scroll, even when it drifts sideways', () => {
    expect(swipeAxis(-3, 12)).toBe('y');
    expect(swipeAxis(18, -60)).toBe('y');
  });

  it('should treat a perfect diagonal as a scroll', () => {
    expect(swipeAxis(15, 15)).toBe('y');
  });
});
