// @vitest-environment happy-dom
/** Diagnostics Share: the native app's own share sheet (the web view's is clipped on iOS, #1490), navigator.share on the PWA. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const HOST = 'samwise.example';
const { fetchFacts, toast, invoke } = vi.hoisted(() => ({
    fetchFacts: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    invoke: vi.fn(),
}));

vi.mock('sonner', () => ({ toast }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({ getHostIdentity: () => HOST, getRoot: () => `https://${HOST}` }),
}));
vi.mock('@/hooks/auth/useAuth', () => ({ useAuth: () => ({ getIdentity: () => HOST }) }));
vi.mock('@/hooks/useSyncService', () => ({
    useSyncService: () => ({ syncStatus: 'idle', pendingCount: { total: 0 }, lastSyncedAt: null, websocketConnected: true }),
}));
vi.mock('@/hooks/useOnlineContext', () => ({ useOnlineContext: () => ({ isOnline: true }) }));
vi.mock('@/hooks/useDeviceType', () => ({ useDeviceType: () => 'mobile' }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ status: 'off' }) }));
vi.mock('@/hooks/useStorageInfo', () => ({ useStorageInfo: () => ({ usage: null, quota: null }), formatBytes: String }));
vi.mock('@/hooks/auth/useMissingPermissions', () => ({ getJournalDriveFixUrl: () => `https://${HOST}/owner/appupdate` }));
vi.mock('@/lib/db', () => ({
    clearRetryBackoff: vi.fn(),
    getAppState: vi.fn(async () => null),
    getDatabaseBreakdown: vi.fn(async () => null),
    getDatabaseInfo: vi.fn(async () => null),
    getPendingSyncItems: vi.fn(async () => []),
    retryPendingImageUploadNow: vi.fn(),
}));
vi.mock('@/lib/homebase/shareNotifications', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/homebase/shareNotifications')>()),
    fetchJournalDriveFacts: fetchFacts,
}));

vi.stubGlobal('__APP_VERSION__', '0.0.0');
vi.stubGlobal('__APP_BUILD__', 'test');

import { useDiagnostics } from '@/hooks/useDiagnostics';

const share = vi.fn();

async function mountHook() {
    let result!: ReturnType<typeof useDiagnostics>;
    const Probe = () => {
        result = useDiagnostics();
        return null;
    };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
        root.render(h(QueryClientProvider, { client: new QueryClient() }, h(Probe)));
    });
    return { get: () => result, unmount: () => act(async () => root.unmount()) };
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    fetchFacts.mockResolvedValue({ attributes: {} });
    invoke.mockReset();
    toast.error.mockReset();
    share.mockReset();
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
});

afterEach(() => {
    delete window.__JOURNAL_NATIVE__;
});

describe('useDiagnostics shareReport', () => {
    it('hands the report to the native plugin in the app, not navigator.share', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios' };
        invoke.mockResolvedValue(true);
        const hook = await mountHook();
        expect(hook.get().canShare).toBe(true);
        await act(async () => hook.get().shareReport());
        expect(invoke).toHaveBeenCalledWith('plugin:export|share_text', {
            text: expect.any(String),
            title: 'Journal diagnostics',
        });
        expect(share).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('shows no toast when the native sheet is cancelled', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios' };
        invoke.mockResolvedValue(false);
        const hook = await mountHook();
        await act(async () => hook.get().shareReport());
        expect(toast.error).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('still uses navigator.share on the PWA, and ignores its AbortError', async () => {
        share.mockRejectedValue(new DOMException('cancelled', 'AbortError'));
        const hook = await mountHook();
        await act(async () => hook.get().shareReport());
        expect(share).toHaveBeenCalledWith({ title: 'Journal diagnostics', text: expect.any(String) });
        expect(invoke).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
        await hook.unmount();
    });
});
