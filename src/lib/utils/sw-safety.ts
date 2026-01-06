
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

const MAX_RELOADS = 3;
const RELOAD_KEY = 'sw_safety_reload_count';
const RELOAD_RESET_TIMEOUT = 10000; // 10 seconds

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

function handleFatalError(error: Error | string) {
    const errorMsg = typeof error === 'string' ? error : error.message || '';

    // Check for known "death loop" errors caused by stale caching
    const isChunkError = errorMsg.includes('Loading chunk') || errorMsg.includes('ChunkLoadError');
    const isReactSyncError = errorMsg.includes("Cannot read properties of null (reading 'useState')") ||
        errorMsg.includes("Minified React error");

    if (isChunkError || isReactSyncError) {
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
