
/**
 * Global error handler to recover from Service Worker caching issues.
 * 
 * In production, a stale Service Worker might serve an old index.html 
 * that tries to load JS chunks that no longer exist (404) or are mismatched.
 * This can cause "ChunkLoadError" or React crashes like "Cannot read properties of null".
 * 
 * This script detects these specific fatal errors and forces a hard reload + SW unregister
 * to recover the user automatically.
 */

import { isChunkLoadError, reloadOnceForChunkError } from './chunkReload';

const MAX_RELOADS = 3;
const RELOAD_KEY = 'sw_safety_reload_count';
const RELOAD_RESET_TIMEOUT = 10000; // 10 seconds
// A null hooks dispatcher, as worded by Chrome, Safari and Firefox, or #321.
const STALE_REACT_ERROR = new RegExp([
    String.raw`Cannot read properties of null \(reading 'use(?:[A-Z]\w*)?'\)`,
    String.raw`null is not an object \(evaluating '[\w$.]*\buse(?:[A-Z]\w*)?'\)`,
    String.raw`can't access property "use(?:[A-Z]\w*)?", [\w$.]+ is null`,
    String.raw`Minified React error #321;`,
].join('|'));

function getReloadCount(): number {
    return parseInt(localStorage.getItem(RELOAD_KEY) || '0', 10);
}

function incrementReloadCount() {
    const count = getReloadCount();
    localStorage.setItem(RELOAD_KEY, (count + 1).toString());
}

function resetReloadCount() {
    localStorage.removeItem(RELOAD_KEY);
}

// Reset the counter if the app stays alive for a while (successful load)
setTimeout(() => {
    resetReloadCount();
}, RELOAD_RESET_TIMEOUT);

function handleFatalError(error: Error | string | undefined) {
    const errorMsg = typeof error === 'string' ? error : error?.message || '';

    // Only duplicate/mismatched-React symptoms (a null hooks dispatcher, or #321
    // invalid hook call) point at a stale bundle. Other React errors are app bugs
    // that a cache wipe + reload can't fix (#247).
    const isReactSyncError = STALE_REACT_ERROR.test(errorMsg);

    if (isChunkLoadError(errorMsg)) {
        // A stale/missing lazy chunk just needs a single reload to fetch the new
        // bundle — touching the SW registration or clearing caches here would also
        // wipe offline support and the api-cache for an error that isn't caused by them.
        console.error('[SW Safety] Chunk load error detected. Attempting recovery...');
        reloadOnceForChunkError();
        return;
    }

    if (isReactSyncError) {
        console.error('[SW Safety] Fatal error detected. Attempting recovery...');

        const count = getReloadCount();
        if (count < MAX_RELOADS) {
            incrementReloadCount();

            // 1. Unregister Service Workers
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then((registrations) => {
                    for (const registration of registrations) {
                        registration.unregister();
                    }
                });
            }

            // 2. Clear Caches
            if ('caches' in window) {
                caches.keys().then((names) => {
                    for (const name of names) {
                        caches.delete(name);
                    }
                });
            }

            // 3. Force Hard Reload
            // Use window.location.href to force a full navigation
            window.location.reload();
        } else {
            console.error('[SW Safety] Max reloads exceeded. Giving up.');
            // Optional: Show a "Please clear your cache" UI to the user if we had a UI framework here
        }
    }
}

// Global Error Listeners
window.addEventListener('error', (event) => {
    handleFatalError(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
    handleFatalError(event.reason);
});

console.log('[SW Safety] Initialized');
