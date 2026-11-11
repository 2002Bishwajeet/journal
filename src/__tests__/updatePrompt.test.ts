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
    onNeedRefresh: undefined as (() => Promise<void>) | undefined,
    onNeedReload: undefined as (() => Promise<void>) | undefined,
    setNeedRefresh: vi.fn(),
    toast: { info: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('virtual:pwa-register/react', () => ({
    useRegisterSW: (opts: {
        onRegisteredSW?: (url: string, r: unknown) => void;
        onNeedRefresh?: () => Promise<void>;
        onNeedReload?: () => Promise<void>;
    }) => {
        mocks.onRegisteredSW = opts.onRegisteredSW;
        mocks.onNeedRefresh = opts.onNeedRefresh;
        mocks.onNeedReload = opts.onNeedReload;
        return {
            needRefresh: [false, mocks.setNeedRefresh],
            offlineReady: [false, vi.fn()],
            updateServiceWorker: vi.fn(),
        };
    },
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { UpdatePrompt } from '@/components/pwa/UpdatePrompt';

vi.stubGlobal('__APP_BUILD__', 'running-build');

/** A service worker that answers GET_BUILD with `build` the way sw.ts does, or never when undefined. */
function fakeWorker(build: string | undefined) {
    return {
        postMessage: vi.fn((message: { type: string }, ports?: MessagePort[]) => {
            if (message.type === 'GET_BUILD' && build !== undefined) ports?.[0]?.postMessage(build);
        }),
    };
}

/** What the browser reports: the registration's waiting worker and the page's controller. */
function setServiceWorker(sw: { waiting?: ReturnType<typeof fakeWorker>; controller?: ReturnType<typeof fakeWorker> }) {
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
            getRegistration: async () => ({ waiting: sw.waiting ?? null }),
            controller: sw.controller ?? null,
        },
    });
}

let now = 1_000_000;

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    setVisibility('visible');
    setServiceWorker({ waiting: fakeWorker('newer-build') });
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

describe('UpdatePrompt — toast deduplication', () => {
    it('uses a stable id to deduplicate update toasts', async () => {
        const p = await mountPrompt();

        await mocks.onNeedRefresh?.();
        await mocks.onNeedRefresh?.();

        expect(mocks.toast.info).toHaveBeenCalledTimes(2);
        expect(mocks.toast.info).toHaveBeenCalledWith(
            'New version available',
            expect.objectContaining({ id: 'sw-update' }),
        );

        await p.unmount();
    });
});

describe('UpdatePrompt — a waiting worker from the build already running', () => {
    // The root page comes from the network, so a launch after a deploy runs the new bundle while
    // the new worker still waits behind the old one. That is not an update to ask about.
    it('lets it take over without a prompt', async () => {
        const waiting = fakeWorker('running-build');
        setServiceWorker({ waiting });
        const p = await mountPrompt();

        await act(async () => { await mocks.onNeedRefresh?.(); });

        expect(mocks.toast.info).not.toHaveBeenCalled();
        expect(mocks.toast.dismiss).toHaveBeenCalledWith('sw-update');
        expect(mocks.setNeedRefresh).toHaveBeenCalledWith(false);
        expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });

        await p.unmount();
    });

    it('prompts for a waiting worker from another build, and does not activate it', async () => {
        const waiting = fakeWorker('newer-build');
        setServiceWorker({ waiting });
        const p = await mountPrompt();

        await act(async () => { await mocks.onNeedRefresh?.(); });

        expect(mocks.toast.info).toHaveBeenCalledWith('New version available', expect.anything());
        expect(waiting.postMessage).not.toHaveBeenCalledWith({ type: 'SKIP_WAITING' });

        await p.unmount();
    });

    it('prompts when the waiting worker never says which build it is', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            setServiceWorker({ waiting: fakeWorker(undefined) });
            const p = await mountPrompt();

            const asked = mocks.onNeedRefresh?.();
            await vi.runAllTimersAsync();
            await asked;

            expect(mocks.toast.info).toHaveBeenCalledWith('New version available', expect.anything());
            await p.unmount();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('UpdatePrompt — when a new worker takes control', () => {
    let reload: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        reload = vi.fn();
        vi.stubGlobal('location', { ...window.location, reload });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal('__APP_BUILD__', 'running-build');
    });

    it('reloads onto the new build after the user accepts the update', async () => {
        setServiceWorker({ controller: fakeWorker('newer-build') });
        const p = await mountPrompt();

        await mocks.onNeedReload?.();

        expect(reload).toHaveBeenCalledTimes(1);
        await p.unmount();
    });

    it('does not reload a page that already runs the build now in control', async () => {
        setServiceWorker({ controller: fakeWorker('running-build') });
        const p = await mountPrompt();

        await mocks.onNeedReload?.();

        expect(reload).not.toHaveBeenCalled();
        await p.unmount();
    });
});
