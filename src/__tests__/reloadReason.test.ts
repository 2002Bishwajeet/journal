// @vitest-environment happy-dom
/**
 * Every reload the app does by itself records why, and the page after it logs that
 * reason once, so a white screen and fresh boot on desktop can be traced to its path (#1368).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installReloadLog, reloadPage } from '@/lib/reloadReason';
import { LAST_RELOAD_KEY } from '@/lib/storage';

let warn: ReturnType<typeof vi.spyOn>;
let reload: ReturnType<typeof vi.fn<() => void>>;

function lastReload(): { reason: string; at: number; logged: boolean } {
    return JSON.parse(localStorage.getItem(LAST_RELOAD_KEY)!);
}

beforeEach(() => {
    localStorage.clear();
    delete window.__JOURNAL_RELOADED__;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reload = vi.fn<() => void>();
    vi.spyOn(window.location, 'reload').mockImplementation(reload);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('reloadPage', () => {
    it('keeps the reason for the next page, then reloads', () => {
        reloadPage('freeze-resume');
        expect(lastReload()).toMatchObject({ reason: 'freeze-resume', logged: false });
        expect(reload).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('[reload] reloading: freeze-resume');
    });
});

describe('installReloadLog', () => {
    it('the page after a reload logs its reason once', () => {
        reloadPage('service-worker-update');
        warn.mockClear();

        installReloadLog();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/^\[reload\] this page follows a reload: service-worker-update at /);
        // Kept for later boots to read, but not logged again.
        expect(lastReload()).toMatchObject({ reason: 'service-worker-update', logged: true });
        installReloadLog();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('logs nothing on a launch without a reload', () => {
        installReloadLog();
        expect(warn).not.toHaveBeenCalled();
        expect(localStorage.getItem(LAST_RELOAD_KEY)).toBeNull();
    });

    it('records the reload the native app did after the content process was killed', () => {
        installReloadLog();
        window.__JOURNAL_RELOADED__!('content-process-terminated');
        expect(lastReload()).toMatchObject({ reason: 'content-process-terminated', logged: true });
        expect(warn).toHaveBeenCalledWith('[reload] reloaded: content-process-terminated');
        expect(reload).not.toHaveBeenCalled();
    });
});
