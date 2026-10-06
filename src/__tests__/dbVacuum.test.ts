import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PGliteInterface } from '@electric-sql/pglite';

async function freshVacuum() {
    vi.resetModules();
    return await import('@/lib/db/vacuum');
}

describe('scheduleVacuum', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('returns at once, runs a plain VACUUM later, and only once per session', async () => {
        const { scheduleVacuum } = await freshVacuum();
        const exec = vi.fn(() => Promise.resolve([]));
        const db = { exec } as unknown as PGliteInterface;

        scheduleVacuum(db);
        scheduleVacuum(db);
        expect(exec).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();
        expect(exec).toHaveBeenCalledTimes(1);
        expect(exec).toHaveBeenCalledWith('VACUUM');
    });

    it('logs a failed VACUUM instead of throwing', async () => {
        const { scheduleVacuum } = await freshVacuum();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const db = { exec: () => Promise.reject(new Error('nope')) } as unknown as PGliteInterface;

        scheduleVacuum(db, 1);
        await vi.runAllTimersAsync();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
