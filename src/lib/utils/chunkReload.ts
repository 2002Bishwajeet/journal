/**
 * Detects a stale/missing lazy-chunk load failure (Vite/browser wordings, a
 * MIME error from the SPA HTML fallback, and legacy webpack strings) and
 * recovers with at most one reload per 10 seconds.
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
    if (typeof err === 'string') return err;
    const message = (err as { message?: unknown } | null | undefined)?.message;
    return typeof message === 'string' ? message : '';
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
