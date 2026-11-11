// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { isNativeApp, nativePlatform } from '@/lib/native';

describe('isNativeApp', () => {
  afterEach(() => {
    delete window.__JOURNAL_NATIVE__;
  });

  it('is false on the web', () => {
    expect(isNativeApp()).toBe(false);
    expect(nativePlatform()).toBeNull();
  });

  it.each(['macos', 'windows', 'linux', 'ios', 'android'] as const)('is true with the platform the shell set (%s)', (platform) => {
    window.__JOURNAL_NATIVE__ = { platform };
    expect(isNativeApp()).toBe(true);
    expect(nativePlatform()).toBe(platform);
  });
});
