import { describe, it, expect } from 'vitest';
import { fitCount } from '@/components/editor/shared/fitCount';

// Items sit 2 px apart and the More button is 34 px wide.
const none = (n: number) => Array<boolean>(n).fill(false);

describe('fitCount', () => {
  it('keeps every item when the row is wide enough', () => {
    expect(fitCount([40, 40, 40], none(3), 124)).toBe(3);
  });

  it('leaves room for the More button when something is left out', () => {
    // More takes 34 px; each item after it takes 42 px with its gap.
    expect(fitCount([40, 40, 40], none(3), 118)).toBe(2);
    expect(fitCount([40, 40, 40], none(3), 100)).toBe(1);
  });

  it('shows only More when not even one item fits', () => {
    expect(fitCount([40, 40], none(2), 50)).toBe(0);
  });

  it('never ends the visible items on a divider', () => {
    // The divider would fit after the first item, but it would separate nothing from More.
    expect(fitCount([20, 5, 50], [false, true, false], 65)).toBe(1);
  });
});
