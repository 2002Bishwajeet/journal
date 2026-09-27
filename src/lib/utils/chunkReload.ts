/**
 * Detects a stale/missing lazy-chunk load failure and recovers with a single
 * reload, once per 10 seconds, instead of letting it fall through to the
 * crash screen.
 *
 * Vite and browsers word this error differently depending on how the chunk
 * fetch failed (network 404, or a MIME-type/HTML fallback from SPA hosting):
 * Chromium says "Failed to fetch dynamically imported module", Firefox says
 * "error loading dynamically imported module", Safari says "Importing a
 * module script failed", and a MIME mismatch says "is not a valid JavaScript
 * MIME type" / "Expected a JavaScript module script". The legacy webpack
 * strings ("Loading chunk" / "ChunkLoadError") are kept for compatibility.
 */
const CHUNK_ERROR_PATTERNS = [
    'failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'importing a module script failed',
    'is not a valid javascript mime type',
    'expected a javascript module script',
    'loading chunk',
    'chunkloaderror',
];

function toMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err && typeof (err as { message?: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return '';
}

export function isChunkLoadError(err: unknown): boolean {
    const message = toMessage(err).toLowerCase();
    return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

const RELOAD_KEY = 'chunk-reload-at';
const RELOAD_WINDOW_MS = 10_000;

/** Reloads the page at most once per RELOAD_WINDOW_MS. Returns whether it reloaded. */
export function reloadOnceForChunkError(): boolean {
    try {
        const last = sessionStorage.getItem(RELOAD_KEY);
        if (last && Date.now() - Number(last) < RELOAD_WINDOW_MS) {
            return false;
        }
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
        return true;
    } catch {
        // sessionStorage can throw in private browsing modes.
        return false;
    }
}
