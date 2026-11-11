import { describe, it, expect } from 'vitest';
import { getKeyboardOffset, getLayoutOffsetTop } from '@/lib/editor/keyboardOffset';

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

// Measured on an iPhone 15 (iOS 27): clientHeight 852, visualViewport.height 456.
describe('getLayoutOffsetTop', () => {
  it('returns offsetTop unchanged in Safari, where clientHeight equals innerHeight', () => {
    expect(getLayoutOffsetTop(0, 852, 852)).toBe(0);
    expect(getLayoutOffsetTop(200, 852, 852)).toBe(200);
    expect(getLayoutOffsetTop(-12, 852, 852)).toBe(-12);
  });

  it('ignores the page scroll that the iOS app WebKit view already took out of innerHeight', () => {
    expect(getLayoutOffsetTop(43, 852, 809)).toBe(0);
    expect(getLayoutOffsetTop(118, 852, 734)).toBe(0);
    expect(getLayoutOffsetTop(147, 852, 705)).toBe(0);
  });

  it('keeps the part of offsetTop that innerHeight did not absorb', () => {
    expect(getLayoutOffsetTop(200, 852, 802)).toBe(150);
  });

  it('never returns a negative offset once innerHeight has shrunk', () => {
    expect(getLayoutOffsetTop(-12, 852, 809)).toBe(0);
    expect(getLayoutOffsetTop(0, 852, 456)).toBe(0);
  });

  it('returns offsetTop unchanged when clientHeight is 0 or less than innerHeight', () => {
    expect(getLayoutOffsetTop(120, 0, 852)).toBe(120);
  });

  it('puts the toolbar on the keyboard at every scroll position in the iOS app', () => {
    for (const [innerHeight, offsetTop] of [[809, 43], [734, 118], [705, 147]]) {
      const offset = getKeyboardOffset(innerHeight, 456, getLayoutOffsetTop(offsetTop, 852, innerHeight));
      expect(innerHeight - offset).toBe(456);
    }
  });

  it('gives the same toolbar offset as before in Safari', () => {
    expect(getKeyboardOffset(852, 516, getLayoutOffsetTop(200, 852, 852))).toBe(136);
  });
});
