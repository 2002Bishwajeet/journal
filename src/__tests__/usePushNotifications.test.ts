// @vitest-environment happy-dom
/**
 * #744: the Notifications opt-in. Permission is asked only from the click, the browser
 * subscription uses the identity's VAPID key and is registered with the identity, and
 * logout drops it while the token still works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { post, calls, homebaseLogout } = vi.hoisted(() => {
    const calls: string[] = [];
    return {
        calls,
        post: vi.fn(async (url: string) => { calls.push(`post ${url}`); return { data: null }; }),
        homebaseLogout: vi.fn(async () => { calls.push('homebaseLogout'); }),
    };
});

vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({
        getHostIdentity: () => 'frodo.dotyou.cloud',
        createAxiosClient: () => ({ post }),
    }),
}));

vi.mock('@homebase-id/js-lib/auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/auth')>()),
    logout: homebaseLogout,
    retrieveIdentity: () => 'frodo.dotyou.cloud',
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/auth/useVerifyToken', () => ({ useVerifyToken: () => ({ data: undefined, isFetchedAfterMount: false }) }));
vi.mock('@/lib/db', () => ({ clearAllLocalData: vi.fn(async () => {}) }));

import NotificationsSection from '@/components/settings/sections/NotificationsSection';
import { WebPushProvider } from '@/lib/homebase/WebPushProvider';
import { useAuth } from '@/hooks/auth/useAuth';

const VAPID_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa';

let host: HTMLDivElement;
let root: Root;
let requestPermission: ReturnType<typeof vi.fn>;
let pushSubscribe: ReturnType<typeof vi.fn>;
let currentSubscription: { endpoint: string; toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> } | null;

function fakeSubscription() {
    return {
        endpoint: 'https://push.example/abc',
        toJSON: () => ({ keys: { auth: 'auth-1', p256dh: 'p256-1' } }),
        unsubscribe: vi.fn(async () => { calls.push('browser unsubscribe'); return true; }),
    };
}

function stubPushSupport(permission: NotificationPermission, grant: NotificationPermission) {
    requestPermission = vi.fn(async () => grant);
    vi.stubGlobal('Notification', { permission, requestPermission });
    vi.stubGlobal('PushManager', class {});
    pushSubscribe = vi.fn(async () => {
        currentSubscription = fakeSubscription();
        return currentSubscription;
    });
    const pushManager = { subscribe: pushSubscribe, getSubscription: async () => currentSubscription };
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { ready: Promise.resolve({ pushManager }), getRegistration: async () => ({ pushManager }) },
    });
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

async function render() {
    await act(async () => { root.render(createElement(NotificationsSection)); });
}

beforeEach(() => {
    calls.length = 0;
    post.mockClear();
    homebaseLogout.mockClear();
    currentSubscription = null;
    vi.spyOn(WebPushProvider.prototype, 'getPublicKey').mockResolvedValue(VAPID_KEY);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe('usePushNotifications', () => {
    it('does not ask for permission on mount', async () => {
        stubPushSupport('default', 'granted');
        await render();
        expect(requestPermission).not.toHaveBeenCalled();
        expect(host.textContent).toContain('Off on this device');
    });

    it('asks for permission, subscribes with the VAPID key, then registers the device', async () => {
        stubPushSupport('default', 'granted');
        await render();
        await act(async () => { button('Turn on')!.click(); });

        expect(requestPermission).toHaveBeenCalledTimes(1);
        expect(pushSubscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: VAPID_KEY });
        expect(post).toHaveBeenCalledWith('/notify/push/subscribe', expect.objectContaining({
            endpoint: 'https://push.example/abc',
            auth: 'auth-1',
            p256dh: 'p256-1',
            friendlyName: expect.stringMatching(/^Journal PWA/),
        }));
        expect(host.textContent).toContain('On on this device');
        expect(button('Turn off')).toBeTruthy();
    });

    it('sends no subscription when permission is denied', async () => {
        stubPushSupport('default', 'denied');
        await render();
        await act(async () => { button('Turn on')!.click(); });

        expect(pushSubscribe).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
        expect(host.textContent).toContain('Blocked by the browser');
    });

    it('turns off: unregisters the device and the browser subscription', async () => {
        stubPushSupport('granted', 'granted');
        currentSubscription = fakeSubscription();
        await render();
        await act(async () => { button('Turn off')!.click(); });

        expect(calls).toEqual(['post /notify/push/unsubscribe', 'browser unsubscribe']);
        expect(host.textContent).toContain('Off on this device');
    });

    it('shows the Home Screen hint in an iOS Safari tab', async () => {
        Object.defineProperty(navigator, 'userAgent', {
            configurable: true,
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
        });
        await render();
        expect(host.textContent).toContain('Add Journal to your Home Screen to get notifications');
        expect(button('Turn on')).toBeUndefined();
        delete (navigator as { userAgent?: string }).userAgent;
    });
});

describe('logout', () => {
    it('unsubscribes this device before the token ends', async () => {
        stubPushSupport('granted', 'granted');
        currentSubscription = fakeSubscription();
        vi.spyOn(WebPushProvider.prototype, 'unsubscribe').mockImplementation(async () => { calls.push('post /notify/push/unsubscribe'); });
        vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        vi.stubGlobal('caches', { delete: vi.fn(async () => true) });
        localStorage.setItem('identity', 'frodo.dotyou.cloud');

        let logout!: () => Promise<void>;
        function Probe() {
            logout = useAuth().logout;
            return null;
        }
        await act(async () => { root.render(createElement(Probe)); });
        await act(async () => { await logout(); });

        expect(calls).toEqual(['post /notify/push/unsubscribe', 'browser unsubscribe', 'homebaseLogout']);
    });
});
