import { httpStatus } from '../httpStatus';

/** The request got no response: unreachable host, dropped connection, timeout. */
function isNetworkError(error: unknown): boolean {
    return (error as { isAxiosError?: unknown } | null)?.isAxiosError === true && httpStatus(error) === undefined;
}

// The hermetic e2e suite (plain http on 127.0.0.1) has no drive: its network fence aborts
// every Homebase request on purpose (e2e/support/network-fence.ts). That is not a failure to show.
function driveFencedOff(): boolean {
    return import.meta.env.MODE === 'e2e' && location.protocol === 'http:';
}

/**
 * A failed request that means sync can't reach or use the Homebase (network, sign-in,
 * permission, server) rather than that one change is bad (#1170).
 */
export function isOutageError(error: unknown): boolean {
    if (isNetworkError(error)) return !driveFencedOff();
    const status = httpStatus(error);
    return status !== undefined && (status >= 500 || status === 401 || status === 403);
}

/**
 * Whether a sync run failed, so the app shows a sync error until a sync that doesn't (#1170):
 * the run threw (`error`), or it moved nothing (`succeeded`) while items failed with an outage
 * error (`outages`). "Sync already in progress" and offline never get here; permanent per-item
 * errors aren't outages and stay in the "N couldn't sync" count.
 */
export function didSyncFail(run: { error?: unknown; succeeded: number; outages: number }): boolean {
    if (run.error !== undefined) return !(isNetworkError(run.error) && driveFencedOff());
    return run.outages > 0 && run.succeeded === 0;
}
