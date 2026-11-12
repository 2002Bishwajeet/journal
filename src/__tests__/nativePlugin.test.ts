// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasNativePlugin, invokeNative } from '@/lib/native';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

afterEach(() => {
  delete window.__JOURNAL_NATIVE__;
  invoke.mockReset();
});

describe('hasNativePlugin', () => {
  it('is false on the web', () => {
    expect(hasNativePlugin('premium')).toBe(false);
  });

  it('is false in the public native build, which has no premium plugins', () => {
    window.__JOURNAL_NATIVE__ = { platform: 'macos', plugins: [] };
    expect(hasNativePlugin('premium')).toBe(false);
  });

  it('is true for a plugin the shell listed', () => {
    window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: ['premium'] };
    expect(hasNativePlugin('premium')).toBe(true);
    expect(hasNativePlugin('tray')).toBe(false);
  });
});

describe('invokeNative', () => {
  it('resolves to undefined on the web without calling Tauri', async () => {
    await expect(invokeNative('premium', 'ping')).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('resolves to undefined when the plugin is absent', async () => {
    window.__JOURNAL_NATIVE__ = { platform: 'linux', plugins: [] };
    await expect(invokeNative('premium', 'ping')).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('forwards to the plugin command when the plugin is there', async () => {
    window.__JOURNAL_NATIVE__ = { platform: 'macos', plugins: ['premium'] };
    invoke.mockResolvedValue('pong');
    await expect(invokeNative<string>('premium', 'ping', { n: 1 })).resolves.toBe('pong');
    expect(invoke).toHaveBeenCalledWith('plugin:premium|ping', { n: 1 });
  });
});
