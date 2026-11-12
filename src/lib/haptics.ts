import { hasNativePlugin, invokeNative, isNativeApp } from '@/lib/native';

// iOS Safari has no `navigator.vibrate`; in the native app the private `journal-haptics` plugin plays UIKit feedback generators instead.
const PATTERNS = { light: 10, medium: 20, warning: [30, 40, 30] };

export function haptic(kind: keyof typeof PATTERNS): void {
  if (isNativeApp() && hasNativePlugin('journal-haptics')) {
    invokeNative('journal-haptics', 'feedback', { kind }).catch(() => {});
    return;
  }
  navigator.vibrate?.(PATTERNS[kind]);
}
