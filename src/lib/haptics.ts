// One place for gesture feedback. iOS Safari has no `navigator.vibrate`, so
// there this does nothing; the Tauri shell (#111) can map it to native haptics.
const PATTERNS: Record<"light" | "medium" | "warning", number | number[]> = {
  light: 10,
  medium: 20,
  warning: [30, 40, 30],
};

export function haptic(kind: keyof typeof PATTERNS): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(PATTERNS[kind]);
}
