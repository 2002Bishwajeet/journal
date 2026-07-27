import { describe, it, expect, beforeEach, vi } from 'vitest';

// The store holds module-level state — get a fresh copy per test.
async function freshStore() {
    vi.resetModules();
    return await import('@/lib/bootProgress');
}

describe('bootProgress', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('starts at 0 and advances through phases', async () => {
        const store = await freshStore();
        expect(store.getBootProgress()).toBe(0);
        store.reportBootPhase('react');
        expect(store.getBootProgress()).toBe(10);
        store.reportBootPhase('db-start');
        expect(store.getBootProgress()).toBe(25);
        store.reportBootPhase('db-worker');
        expect(store.getBootProgress()).toBe(65);
        store.reportBootPhase('db-ready');
        expect(store.getBootProgress()).toBe(85);
        store.reportBootPhase('notes-rendered');
        expect(store.getBootProgress()).toBe(95);
    });

    it('logs the db-start → first note timing once the note list renders', async () => {
        const store = await freshStore();
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const now = vi.spyOn(performance, 'now');

        now.mockReturnValue(100);
        store.reportBootPhase('react');
        now.mockReturnValue(200);
        store.reportBootPhase('db-start');
        now.mockReturnValue(1800);
        store.reportBootPhase('db-worker');
        now.mockReturnValue(2000);
        store.reportBootPhase('db-ready');
        expect(log).not.toHaveBeenCalled();

        now.mockReturnValue(2300);
        store.reportBootPhase('notes-rendered');
        // The line is emitted from a promise chain so the storage estimate can
        // ride along with it — let that microtask settle before asserting.
        await Promise.resolve();
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain('db-start → first note: 2100ms');
        expect(log.mock.calls[0][1]).toEqual({
            react: 100,
            dbStart: 200,
            dbWorker: 1800,
            dbReady: 2000,
            firstNote: 2300,
            storageMB: null,
        });

        // Monotonic guard: a repeat report must not log a second time.
        store.reportBootPhase('notes-rendered');
        await Promise.resolve();
        expect(log).toHaveBeenCalledTimes(1);

        log.mockRestore();
        now.mockRestore();
    });

    it('is monotonic — an earlier or repeated phase never moves the bar back', async () => {
        const store = await freshStore();
        store.reportBootPhase('db-worker');
        expect(store.getBootProgress()).toBe(65);
        store.reportBootPhase('react');
        store.reportBootPhase('db-worker');
        expect(store.getBootProgress()).toBe(65);
    });

    it('notifies subscribers only on actual progress, and unsubscribe works', async () => {
        const store = await freshStore();
        const listener = vi.fn();
        const unsubscribe = store.subscribeBootProgress(listener);

        store.reportBootPhase('react');
        expect(listener).toHaveBeenCalledTimes(1);
        // No-op report (monotonic guard) must not notify.
        store.reportBootPhase('react');
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        store.reportBootPhase('db-start');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.getBootProgress()).toBe(25);
    });
});
