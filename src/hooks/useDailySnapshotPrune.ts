import { useEffect } from 'react';
import { runDailySnapshotPrune } from '@/lib/history/dailyPrune';

const START_DELAY_MS = 60_000;
const CHECK_EVERY_MS = 3_600_000;

/**
 * Runs the daily snapshot prune (#1054) a minute after the shell mounts, off the boot
 * path, then checks hourly so a tab left open for days still prunes once a day.
 */
export function useDailySnapshotPrune(): void {
    useEffect(() => {
        const run = () =>
            runDailySnapshotPrune().catch((error) => console.warn('[history] Daily snapshot prune failed:', error));
        const start = setTimeout(run, START_DELAY_MS);
        const interval = setInterval(run, CHECK_EVERY_MS);
        return () => {
            clearTimeout(start);
            clearInterval(interval);
        };
    }, []);
}
