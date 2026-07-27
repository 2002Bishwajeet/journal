// Boolean feature gates for shipped-but-unpolished features. UI behind a
// false flag is hidden everywhere it surfaces; flip to true to re-enable
// while polishing. The underlying hooks/data stay intact either way.
export const FEATURES = {
    dailyNotes: false,
    templates: false,
} as const;

// Phones and tablets. iPadOS 13+ reports a desktop Safari UA, so touch points
// are the only tell there.
function isMobileOrTablet(): boolean {
    const ua = navigator.userAgent;
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
    return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
}

/**
 * Whether the on-device LLM may run on this platform.
 *
 * WebLLM requires WebGPU, which is absent from iOS WKWebView and from Android
 * System WebView, so `navigator.gpu` is the real disqualifier. Phones and
 * tablets are excluded even where WebGPU exists (Chrome on Android): a
 * multi-GB model gets the webview process killed for memory long before it is
 * useful. Check this before the dynamic import so weights are never fetched.
 */
export function isOnDeviceLLMAvailable(): boolean {
    if (typeof navigator === 'undefined') return false;
    if (!('gpu' in navigator)) return false;
    return !isMobileOrTablet();
}
