import type { InvokeArgs } from '@tauri-apps/api/core';

// The Tauri shell's initialization script (src-tauri/src/lib.rs) sets
// `window.__JOURNAL_NATIVE__` before any app code runs. The web never sets it.
export type NativePlatform = 'macos' | 'windows' | 'linux' | 'ios' | 'android';

declare global {
  interface Window {
    /** `plugins`: the premium Tauri plugins from the private native/ submodule. */
    __JOURNAL_NATIVE__?: { platform: NativePlatform; plugins: string[] };
  }
}

/** The native app's platform, or null on the web. */
export function nativePlatform(): NativePlatform | null {
  return window.__JOURNAL_NATIVE__?.platform ?? null;
}

/** True inside the desktop or mobile app, false in a browser. */
export function isNativeApp(): boolean {
  return nativePlatform() !== null;
}

/** True when the native app has the premium plugin `name`; always false on the web. */
export function hasNativePlugin(name: string): boolean {
  return window.__JOURNAL_NATIVE__?.plugins.includes(name) ?? false;
}

/**
 * Runs `command` of the premium plugin `plugin`. Resolves to `undefined` without
 * calling anything when the plugin is absent (the public build, or the web).
 */
export async function invokeNative<T>(plugin: string, command: string, args?: InvokeArgs): Promise<T | undefined> {
  if (!hasNativePlugin(plugin)) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(`plugin:${plugin}|${command}`, args);
}

/** The hosted app. Links for other people point here from the native app. */
export const PUBLIC_ORIGIN = 'https://journal.cloudx.run';

/**
 * The origin of links the app hands to other people (share, folder and feed links).
 * The native app's own origin is `http://localhost:47821` (src-tauri/src/lib.rs), so
 * it uses the hosted app; the web uses its own origin, so dev and preview keep theirs.
 */
export function publicOrigin(): string {
  return isNativeApp() ? PUBLIC_ORIGIN : window.location.origin;
}
