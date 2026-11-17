import { LAST_RELOAD_KEY, readJson, writeJson } from '@/lib/storage';

/**
 * Why the page reloaded by itself (#1368). The desktop app came back from a long time in
 * the background as a white screen and then a fresh boot; this names the reload so the
 * Diagnostics log shows which path it was. The reason is kept in localStorage and logged
 * as a warning (which Settings → Diagnostics keeps) on the boot after the reload.
 *
 * - `content-process-terminated`: the OS killed the web view's content process and the
 *   native app loaded the page again (src-tauri/src/webview_recovery.rs). The old page is
 *   gone by then, so the app tells the new one through `window.__JOURNAL_RELOADED__`.
 * - `pageshow-persisted`, `freeze-resume`: the page came back from the back/forward cache
 *   or a freeze with its database worker stopped (src/lib/db/pglite.ts).
 * - `service-worker-update`: a new service worker took over (UpdatePrompt.tsx).
 * - `chunk-error`, `stale-bundle`: a lazy chunk failed to load, or React broke the way a
 *   stale bundle does (chunkReload.ts, sw-safety.ts).
 */
export type ReloadReason =
    | 'content-process-terminated'
    | 'pageshow-persisted'
    | 'freeze-resume'
    | 'service-worker-update'
    | 'chunk-error'
    | 'stale-bundle';

interface LastReload {
    reason: ReloadReason;
    at: number;
    /** Whether a page has logged it yet. */
    logged: boolean;
}

declare global {
    interface Window {
        __JOURNAL_RELOADED__?: (reason: ReloadReason) => void;
    }
}

function record(reason: ReloadReason, logged: boolean): void {
    const last: LastReload = { reason, at: Date.now(), logged };
    writeJson(LAST_RELOAD_KEY, last);
    console.warn(`[reload] ${logged ? 'reloaded' : 'reloading'}: ${reason}`);
}

/** Records the reason, then reloads the page. */
export function reloadPage(reason: ReloadReason): void {
    record(reason, false);
    location.reload();
}

/**
 * Logs the reason of the reload that started this page, if no page has logged it yet, and
 * lets the native app record a reload it did itself.
 */
export function installReloadLog(): void {
    const last = readJson<Partial<LastReload>>(LAST_RELOAD_KEY);
    if (last?.reason && typeof last.at === 'number' && !last.logged) {
        console.warn(`[reload] this page follows a reload: ${last.reason} at ${new Date(last.at).toISOString()}`);
        writeJson(LAST_RELOAD_KEY, { ...last, logged: true });
    }
    window.__JOURNAL_RELOADED__ = (reason) => record(reason, true);
}
