import { RESUME_STATE_KEY, readJson, removeKey, writeJson } from '@/lib/storage';

/**
 * Puts a reloaded page back where it was (#1187). iOS kills a backgrounded web view's
 * content process to free memory, and the native app (src-tauri/src/ios_recovery.rs)
 * or iOS Safari then loads the page's URL again, so the route and the open note come
 * back by themselves, and the note's text is already safe (Yjs updates in PGlite, plus
 * the synchronous copy in unsavedEdits.ts). What the new load loses is the note's scroll
 * position, so it is saved whenever the page is hidden and put back when the same URL
 * loads again, once the note is tall enough. When iOS ends the whole app instead, the
 * next launch loads `/` and session restore (useSessionPersistence) moves on to the last
 * note; the scroll position is put back there too. In localStorage: sessionStorage
 * doesn't survive the content process on iOS.
 *
 * `window.__JOURNAL_RESTORED__` tells the native app the page is back, so it can take
 * away the snapshot it covers the reload with.
 */
const RESTORE_TIMEOUT_MS = 8000;

interface ResumeState {
    path: string;
    /** The open note's scroll offset; null when no note was open. */
    scrollTop: number | null;
}

declare global {
    interface Window {
        __JOURNAL_RESTORED__?: boolean;
    }
}

// Set on logout, so the pagehide of logout's own reload cannot save the state again.
let discarded = false;

/** Desktop keeps every open tab's note mounted; only the shown one has a height. */
function visibleNoteScroller(): HTMLElement | null {
    const scrollers = document.querySelectorAll<HTMLElement>('[data-note-scroller]');
    return Array.from(scrollers).find((el) => el.clientHeight > 0) ?? null;
}

function currentPath(): string {
    return location.pathname + location.search;
}

export function saveResumeState(): void {
    if (discarded) return;
    const state: ResumeState = { path: currentPath(), scrollTop: visibleNoteScroller()?.scrollTop ?? null };
    writeJson(RESUME_STATE_KEY, state);
}

/** Logout: delete the saved state and stop saving it in this page. */
export function discardResumeState(): void {
    discarded = true;
    removeKey(RESUME_STATE_KEY);
}

/** A new launch, which session restore moves from `/` to the last note: its own conditions. */
function isLaunch(): boolean {
    const [load] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return location.pathname === '/' && !location.search && (!load || load.type === 'navigate');
}

/** The app has replaced the splash (index.html's first frame, then SplashScreen). */
function appRendered(): boolean {
    const root = document.getElementById('root');
    return !!root?.firstElementChild && !root.querySelector('[data-splash]');
}

/**
 * Saves the scroll position whenever the page is hidden. After a load of the URL it was
 * saved on, or a launch that session restore takes there, scrolls the note back once it
 * has rendered, then sets `window.__JOURNAL_RESTORED__`. Any other route leaves the
 * scroll alone.
 */
export function installResumeRestore(): void {
    // pagehide too: iOS can unload a page without a visibilitychange.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveResumeState();
    });
    window.addEventListener('pagehide', saveResumeState);

    const saved = readJson<Partial<ResumeState>>(RESUME_STATE_KEY);
    const savedTop = typeof saved?.scrollTop === 'number' ? saved.scrollTop : null;
    // Session restore's first move off `/` decides; a later navigation never scrolls.
    const awaitsSessionRestore = isLaunch() && savedTop !== null && saved?.path !== '/';
    const deadline = Date.now() + RESTORE_TIMEOUT_MS;
    const step = () => {
        const path = currentPath();
        const waiting = awaitsSessionRestore && path === '/';
        const target = !waiting && path === saved?.path ? savedTop : null;
        const scroller = target === null ? null : visibleNoteScroller();
        const ready = appRendered() && !waiting
            && (target === null || (!!scroller && scroller.scrollHeight - scroller.clientHeight >= target));
        if (!ready && Date.now() < deadline) {
            requestAnimationFrame(step);
            return;
        }
        if (scroller && target !== null) scroller.scrollTop = target;
        window.__JOURNAL_RESTORED__ = true;
    };
    step();
}
