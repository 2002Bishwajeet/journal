/**
 * E2E-only readiness hooks. Installed exclusively from `main.tsx`'s
 * `if (import.meta.env.MODE === 'e2e')` branch via a dynamic import, so this
 * module (and its `window.__journalE2E` global) never ships in the production
 * bundle. See src/globals.d.ts for the public type.
 *
 * Nothing here mutates app state — the hooks only read signals the app
 * already maintains (bootProgress and the boot splash) or draw a link card.
 */
import { getBootError, getBootProgress, PHASE_PROGRESS, subscribeBootProgress } from '@/lib/bootProgress';

const E2E_ORIGINS = [
    'http://127.0.0.1:4173',
    'http://127.0.0.1:5174',
    'https://e2e.dotyou.cloud:4443',
];

// Progress is monotonic, so reaching db-ready's value means db-ready has fired.
// A boot error rejects instead, so the fixture reports it rather than timing out.
function waitForDbReady(): Promise<void> {
    return new Promise((resolve, reject) => {
        const settle = () => {
            const error = getBootError();
            if (!error && getBootProgress() < PHASE_PROGRESS['db-ready']) return;
            unsubscribe();
            if (error) reject(error);
            else resolve();
        };
        const unsubscribe = subscribeBootProgress(settle);
        settle();
    });
}

// The boot splash (src/components/layout/SplashScreen.tsx) is the only
// element in the app with role="progressbar" — its removal from the DOM is
// what "the main UI mounted" means in practice, since the splash is replaced
// by the real layout rather than transitioning through some other signal.
function isSplashGone(): boolean {
    return document.querySelector('[role="progressbar"]') === null;
}

function waitForSplashGone(): Promise<void> {
    if (isSplashGone()) return Promise.resolve();
    return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            if (isSplashGone()) {
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

async function ready(): Promise<void> {
    await waitForDbReady();
    await waitForSplashGone();
}

/** Draw a link card image (#434) the way publishing does; nothing is stored or uploaded. */
async function renderCard(...args: Parameters<JournalE2EHooks['renderCard']>): Promise<Blob> {
    const { renderCardImage } = await import('@/lib/share/cardImage');
    return renderCardImage(...args);
}

/** True while an edit is still queued for, or being written to, PGlite (the document and the editor's search-index write). */
async function hasUnsavedEdits(): Promise<boolean> {
    const { PGliteProvider } = await import('@/lib/yjs/provider');
    const { hasPendingEditorWrites } = await import('@/lib/yjs/pendingEditorWrites');
    return PGliteProvider.hasUnpersistedUpdates() || hasPendingEditorWrites();
}

/** Resolves once PGlite has flushed everything it committed to IndexedDB (a commit returns before that). */
async function syncToDisk(): Promise<void> {
    const { getDatabase } = await import('@/lib/db/pglite');
    await (await getDatabase()).syncToFs();
}

if (E2E_ORIGINS.includes(location.origin)) {
    Object.defineProperty(window, '__journalE2E', {
        value: Object.freeze({ ready, renderCard, hasUnsavedEdits, syncToDisk }),
        writable: false,
        configurable: false,
        enumerable: false,
    });
}
