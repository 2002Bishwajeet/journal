// @vitest-environment happy-dom
/**
 * The update prompt is the only way an installed client leaves the old bundle:
 * registerType is 'prompt' and sw.ts only calls skipWaiting() on an explicit
 * SKIP_WAITING message, so a waiting service worker sits there until the user
 * accepts the toast. An hourly poll alone means a tab left open can serve the
 * old build for an hour, so the check also runs when the tab comes back to the
 * foreground — throttled, so rapid tab switching can't spam the request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
    update: vi.fn<() => Promise<void>>(async () => { }),
    onRegisteredSW: undefined as ((url: string, r: unknown) => void) | undefined,
    toast: { info: vi.fn(), success: vi.fn() },
}));

vi.mock('virtual:pwa-register/react', () => ({
    useRegisterSW: (opts: { onRegisteredSW?: (url: string, r: unknown) => void }) => {
        mocks.onRegisteredSW = opts.onRegisteredSW;
        return {
            needRefresh: [false, vi.fn()],
            offlineReady: [false, vi.fn()],
            updateServiceWorker: vi.fn(),
        };
    },
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { UpdatePrompt } from '@/components/pwa/UpdatePrompt';

let now = 1_000_000;

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    setVisibility('visible');
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** happy-dom's visibilityState is a getter, so it has to be redefined. */
function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
    });
}

const foreground = () => act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
});

async function mountPrompt() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(h(UpdatePrompt)); });
    // The component only keeps the registration handed to it by onRegisteredSW.
    await act(async () => {
        mocks.onRegisteredSW?.('/sw.js', { update: mocks.update });
    });
    return {
        unmount: async () => { await act(async () => root.unmount()); el.remove(); },
    };
}

describe('UpdatePrompt — when it checks for a waiting service worker', () => {
    it('checks as soon as the tab returns to the foreground', async () => {
        const p = await mountPrompt();

        await foreground();

        expect(mocks.update).toHaveBeenCalledTimes(1);

        await p.unmount();
    });

    it('throttles repeated foreground events instead of spamming the request', async () => {
        const p = await mountPrompt();

        await foreground();
        now += 5_000; // still inside the 60s floor
        await foreground();
        await foreground();

        expect(mocks.update).toHaveBeenCalledTimes(1);

        // Once the floor has passed, the next foreground checks again.
        now += 60_000;
        await foreground();
        expect(mocks.update).toHaveBeenCalledTimes(2);

        await p.unmount();
    });

    it('does not check while the tab is hidden', async () => {
        const p = await mountPrompt();

        setVisibility('hidden');
        await foreground();

        expect(mocks.update).not.toHaveBeenCalled();

        await p.unmount();
    });

    it('stops checking once unmounted', async () => {
        const p = await mountPrompt();
        await p.unmount();

        now += 120_000;
        await foreground();

        expect(mocks.update).not.toHaveBeenCalled();
    });
});
