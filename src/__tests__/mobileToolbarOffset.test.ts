import { describe, it, expect } from 'vitest';
import { getKeyboardOffset } from '@/lib/editor/keyboardOffset';

describe('getKeyboardOffset', () => {
  it('is 0 when the layout was resized for the keyboard', () => {
    expect(getKeyboardOffset(516, 516, 0)).toBe(0);
  });

  it('is 0 when no keyboard is up', () => {
    expect(getKeyboardOffset(852, 852, 0)).toBe(0);
  });

  it('equals the keyboard height when only the visual viewport shrank', () => {
    expect(getKeyboardOffset(852, 516, 0)).toBe(336);
  });

  it('accounts for the visual viewport scrolling inside the layout viewport', () => {
    expect(getKeyboardOffset(852, 516, 200)).toBe(136);
  });

  it('never returns a negative offset', () => {
    expect(getKeyboardOffset(852, 700, 300)).toBe(0);
  });
});
