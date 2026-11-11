import { describe, it, expect } from 'vitest';
import { getOverscroll, getStretch, MAX_STRETCH, rubberBand, springEasing } from '@/lib/editor/toolbarOverscroll';

describe('getOverscroll', () => {
  it('is 0 while the row can still scroll', () => {
    expect(getOverscroll(0, 100, 400)).toBe(0);
    expect(getOverscroll(60, 100, 400)).toBe(0);
    expect(getOverscroll(-200, 100, 400)).toBe(0);
  });

  it('is positive past the start: only the part of the drag the row could not scroll', () => {
    expect(getOverscroll(130, 100, 400)).toBe(30);
    expect(getOverscroll(40, 0, 400)).toBe(40);
  });

  it('is negative past the end', () => {
    expect(getOverscroll(-330, 100, 400)).toBe(-30);
    expect(getOverscroll(-25, 400, 400)).toBe(-25);
  });

  it('is never past an end the drag did not reach', () => {
    expect(getOverscroll(-10, 0, 400)).toBe(0);
    expect(getOverscroll(10, 400, 400)).toBe(0);
  });
});

describe('rubberBand', () => {
  it('moves the content less than the finger, more slowly the further it pulls', () => {
    const near = rubberBand(20, 300);
    const far = rubberBand(200, 300);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(20);
    expect(far).toBeLessThan(200);
    expect(far / 200).toBeLessThan(near / 20);
  });

  it('keeps the direction and never passes the row width', () => {
    expect(rubberBand(-50, 300)).toBeCloseTo(-rubberBand(50, 300));
    expect(rubberBand(100_000, 300)).toBeLessThan(300);
    expect(rubberBand(0, 300)).toBe(0);
  });
});

describe('getStretch', () => {
  it('is 1 at rest and grows with the pull, either way', () => {
    expect(getStretch(0, 300)).toBe(1);
    expect(getStretch(15, 300)).toBeCloseTo(1.025);
    expect(getStretch(-15, 300)).toBeCloseTo(1.025);
  });

  it('stays a slight stretch', () => {
    expect(getStretch(300, 300)).toBe(1 + MAX_STRETCH);
  });
});

describe('springEasing', () => {
  const values = (easing: string) => easing.slice('linear('.length, -1).split(', ').map(Number);

  it('runs from 0 to 1 and settles', () => {
    const { easing, ms } = springEasing();
    const points = values(easing);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(1600);
  });

  it('is firm: it overshoots only a little', () => {
    const peak = Math.max(...values(springEasing().easing));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.05);
  });

  it('does not overshoot with no bounce', () => {
    expect(Math.max(...values(springEasing(400, 0.0001).easing))).toBeLessThanOrEqual(1.0001);
  });
});
