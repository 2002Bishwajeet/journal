// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptic } from '@/lib/haptics';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('haptic', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
    delete window.__JOURNAL_NATIVE__;
    invoke.mockReset();
  });

  it.each([
    ['light', 10],
    ['medium', 20],
    ['warning', [30, 40, 30]],
  ] as const)('vibrates with the %s pattern', (kind, pattern) => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic(kind);
    expect(vibrate).toHaveBeenCalledWith(pattern);
  });

  it('does nothing and does not throw when vibrate is missing', () => {
    expect(() => haptic('light')).not.toThrow();
  });

  describe('in the native app', () => {
    it.each(['light', 'medium', 'warning'] as const)('calls the haptics plugin for %s, not vibrate', async (kind) => {
      window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: ['journal-haptics'] };
      invoke.mockResolvedValue(undefined);
      const vibrate = vi.fn();
      Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
      haptic(kind);
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('plugin:journal-haptics|feedback', { kind }));
      expect(vibrate).not.toHaveBeenCalled();
    });

    it('swallows plugin errors', async () => {
      window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: ['journal-haptics'] };
      invoke.mockRejectedValue(new Error('no taptic engine'));
      expect(() => haptic('medium')).not.toThrow();
      await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    });

    it('falls back to vibrate when the plugin is missing', () => {
      window.__JOURNAL_NATIVE__ = { platform: 'android', plugins: [] };
      const vibrate = vi.fn();
      Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
      haptic('light');
      expect(vibrate).toHaveBeenCalledWith(10);
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});
