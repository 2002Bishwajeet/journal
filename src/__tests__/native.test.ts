// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { isNativeApp, nativePlatform, publicOrigin } from '@/lib/native';

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

describe('publicOrigin', () => {
  afterEach(() => {
    delete window.__JOURNAL_NATIVE__;
  });

  it('is this origin on the web, so dev and preview links stay on their own host', () => {
    expect(publicOrigin()).toBe(window.location.origin);
  });

  it.each(['macos', 'windows', 'linux', 'ios', 'android'] as const)('is journal.cloudx.run in the native app, not its localhost origin (%s)', (platform) => {
    window.__JOURNAL_NATIVE__ = { platform };
    expect(publicOrigin()).toBe('https://journal.cloudx.run');
  });
});
