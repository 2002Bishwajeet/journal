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
});
