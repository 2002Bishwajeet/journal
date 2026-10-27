// iOS Safari has no `navigator.vibrate`, so there this does nothing; the Tauri shell (#111) can map it to native haptics.
const PATTERNS = { light: 10, medium: 20, warning: [30, 40, 30] };

export function haptic(kind: keyof typeof PATTERNS): void {
  navigator.vibrate?.(PATTERNS[kind]);
}
