import { describe, it, expect } from 'vitest';
import { getCaretScrollDelta } from '@/lib/editor/keyboardOffset';

describe('getCaretScrollDelta', () => {
  it('is 0 when the caret is well above the toolbar', () => {
    expect(getCaretScrollDelta(300, 852, 852, 787)).toBe(0);
  });

  it('keeps 16px above the toolbar', () => {
    expect(getCaretScrollDelta(780, 852, 852, 787)).toBe(780 - (787 - 16));
  });

  it('uses the container edge when there is no toolbar', () => {
    expect(getCaretScrollDelta(840, 852, 852, null)).toBe(4);
  });

  it('uses the visual viewport when the keyboard only shrank it', () => {
    expect(getCaretScrollDelta(500, 852, 516, 451)).toBe(500 - (451 - 16));
    expect(getCaretScrollDelta(500, 852, 516, null)).toBe(0);
    expect(getCaretScrollDelta(510, 852, 516, null)).toBe(10);
  });
});
