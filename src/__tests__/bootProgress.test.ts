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

    it('maps pglite-cipher block counts to a whole percent, clamped, an empty store done (#1365)', async () => {
        const { openPercent } = await freshStore();
        expect(openPercent(0, 200)).toBe(0);
        expect(openPercent(1, 3)).toBe(33);
        expect(openPercent(100, 200)).toBe(50);
        expect(openPercent(200, 200)).toBe(100);
        expect(openPercent(300, 200)).toBe(100);
        expect(openPercent(-5, 200)).toBe(0);
        expect(openPercent(0, 0)).toBe(100);
    });

    it('tracks an encrypted open monotonically and ignores progress when none began (#1365)', async () => {
        const store = await freshStore();
        store.reportOpenProgress(50, 100);
        expect(store.getOpenProgress()).toBeNull();

        const listener = vi.fn();
        store.subscribeBootProgress(listener);
        store.startOpenProgress();
        expect(store.getOpenProgress()?.percent).toBe(0);
        store.reportOpenProgress(40, 100);
        store.reportOpenProgress(10, 100);
        expect(store.getOpenProgress()?.percent).toBe(40);
        // start, 40 %; the 10 % report moved nothing.
        expect(listener).toHaveBeenCalledTimes(2);

        store.finishOpenProgress();
        expect(store.getOpenProgress()).toBeNull();
        expect(listener).toHaveBeenCalledTimes(3);
        store.finishOpenProgress();
        expect(listener).toHaveBeenCalledTimes(3);
    });
});
