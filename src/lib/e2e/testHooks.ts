/**
 * E2E-only readiness hooks. Installed exclusively from `main.tsx`'s
 * `if (import.meta.env.MODE === 'e2e')` branch via a dynamic import, so this
 * module (and its `window.__journalE2E` global) never ships in the production
 * bundle. See src/globals.d.ts for the public type.
 *
 * Nothing here mutates app state — both hooks only read signals the app
 * already maintains (bootProgress, the DB's sync-queue tables).
 */
import { getBootProgress, subscribeBootProgress } from '@/lib/bootProgress';
import { getPendingSyncCount } from '@/lib/db';

const E2E_ORIGINS = [
    'http://127.0.0.1:4173',
    'http://127.0.0.1:5174',
    'https://e2e.dotyou.cloud:4443',
];

// The db-ready phase is bootProgress's last milestone (see PHASE_PROGRESS in
// src/lib/bootProgress.ts) — progress is monotonic, so reaching this value
// means db-ready has fired. Not exported by that module, so duplicated here.
const DB_READY_PROGRESS = 85;

function waitForDbReady(): Promise<void> {
    if (getBootProgress() >= DB_READY_PROGRESS) return Promise.resolve();
    return new Promise((resolve) => {
        const unsubscribe = subscribeBootProgress(() => {
            if (getBootProgress() >= DB_READY_PROGRESS) {
                unsubscribe();
                resolve();
            }
        });
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

// SyncService's own status ('idle' | 'syncing' | 'error') is private and only
// reachable through React context inside the signed-in component tree — there
// is no way to read it from a plain module without adding new state to the
// service or to a shared provider, and in this hermetic sandbox it spends
// most of its time cycling 'syncing' -> 'error' (every remote call is aborted
// by the network fence, then retried), so it would rarely settle on 'idle'
// anyway. "No queued work" — the sync_records / pending_image_uploads rows
// SyncService itself pushes and pulls against — is the signal that's both
// derivable from existing state and actually observable in this environment.
async function syncIdle(): Promise<void> {
    const settleChecks = 3;
    const pollMs = 150;
    let stable = 0;
    while (stable < settleChecks) {
        const counts = await getPendingSyncCount();
        const total = counts.notes + counts.folders + counts.images;
        stable = total === 0 ? stable + 1 : 0;
        if (stable < settleChecks) {
            await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
    }
}

if (E2E_ORIGINS.includes(location.origin)) {
    Object.defineProperty(window, '__journalE2E', {
        value: Object.freeze({ ready, syncIdle }),
        writable: false,
        configurable: false,
        enumerable: false,
    });
}
