import type { BrowserContext } from '@playwright/test';
import { TEST_ORIGINS } from './origin-guard';

/**
 * Installs a network fence on `context`: only the allowlisted app origins are
 * reachable. `*.homebase.test` requests are aborted too (there is no fake
 * drive — see #196 — a future recorded-traffic replayer (#202) or live tier
 * (#204) would register their own handler here), but that's expected, so it
 * doesn't count as a violation. Anything else is aborted and recorded — call
 * `assertNoFenceViolations` during teardown so a stray request to an
 * unexpected origin fails the test instead of just disappearing.
 */
export async function installNetworkFence(context: BrowserContext): Promise<{ violations: string[] }> {
    const violations: string[] = [];

    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());

        if (TEST_ORIGINS.includes(url.origin)) {
            return route.continue();
        }

        if (url.hostname.endsWith('.homebase.test')) {
            return route.abort('internetdisconnected');
        }

        violations.push(url.href);
        return route.abort('internetdisconnected');
    });

    return { violations };
}

export function assertNoFenceViolations(violations: string[]): void {
    if (violations.length > 0) {
        throw new Error(`Network fence blocked unexpected origin(s): ${violations.join(', ')}`);
    }
}
