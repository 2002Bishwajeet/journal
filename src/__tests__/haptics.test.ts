import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptic } from '@/lib/haptics';

describe('haptic', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it.each([
    ['light', 10],
    ['medium', 20],
  ] as const)('vibrates with the %s pattern', (kind, pattern) => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic(kind);
    expect(vibrate).toHaveBeenCalledWith(pattern);
  });

  it('does nothing and does not throw when vibrate is missing', () => {
    expect(() => haptic('light')).not.toThrow();
  });
});
