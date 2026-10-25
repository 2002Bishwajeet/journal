// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTouchDevice } from '@/lib/utils';

describe('isTouchDevice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])('follows the (pointer: coarse) media query: %s', (coarse) => {
    const matchMedia = vi.fn((query: string) => ({ matches: coarse && query === '(pointer: coarse)' }));
    vi.stubGlobal('matchMedia', matchMedia);
    expect(isTouchDevice()).toBe(coarse);
  });
});
