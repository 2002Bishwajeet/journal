// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const { runDailySnapshotPrune } = vi.hoisted(() => ({ runDailySnapshotPrune: vi.fn(async () => {}) }));
vi.mock('@/lib/history/dailyPrune', () => ({ runDailySnapshotPrune }));

import { useDailySnapshotPrune } from '@/hooks/useDailySnapshotPrune';

function Probe() {
    useDailySnapshotPrune();
    return null;
}

describe('useDailySnapshotPrune', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        runDailySnapshotPrune.mockClear();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('runs the pass a minute after mount, then checks hourly until unmount', async () => {
        const root = createRoot(document.createElement('div'));
        await act(async () => root.render(h(Probe)));
        expect(runDailySnapshotPrune).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(runDailySnapshotPrune).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(3_600_000);
        expect(runDailySnapshotPrune).toHaveBeenCalledTimes(2);

        act(() => root.unmount());
        await vi.advanceTimersByTimeAsync(3_600_000);
        expect(runDailySnapshotPrune).toHaveBeenCalledTimes(2);
    });

    it('a failed pass is logged, not thrown', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        runDailySnapshotPrune.mockRejectedValueOnce(new Error('boom'));
        const root = createRoot(document.createElement('div'));
        await act(async () => root.render(h(Probe)));

        await vi.advanceTimersByTimeAsync(60_000);

        expect(warn).toHaveBeenCalledWith('[history] Daily snapshot prune failed:', expect.any(Error));
        act(() => root.unmount());
        warn.mockRestore();
    });
});
