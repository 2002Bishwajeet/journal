// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTouchDevice, isFinePointerDevice } from '@/lib/utils';

describe('isTouchDevice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])('follows the (pointer: coarse) media query: %s', (coarse) => {
    const matchMedia = vi.fn((query: string) => ({ matches: coarse && query === '(pointer: coarse)' }));
    vi.stubGlobal('matchMedia', matchMedia);
    expect(isTouchDevice()).toBe(coarse);
  });
});

describe('isFinePointerDevice', () => {
  afterEach(() => vi.unstubAllGlobals());

  const device = (finePointer: boolean, maxTouchPoints: number) => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: finePointer && query === '(pointer: fine)' }));
    vi.stubGlobal('navigator', { maxTouchPoints });
    return isFinePointerDevice();
  };

  it('is true for a mouse or trackpad with no touch screen (a Mac or PC)', () => {
    expect(device(true, 0)).toBe(true);
  });

  it('is false for an iPad with a trackpad: it has touch', () => {
    expect(device(true, 5)).toBe(false);
  });

  it('is false for a phone or tablet whose primary pointer is a finger', () => {
    expect(device(false, 5)).toBe(false);
  });
});
