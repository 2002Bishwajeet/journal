// @vitest-environment happy-dom
/**
 * Back from the owner console's extend-permissions page (#870), Diagnostics must re-read the journal
 * drive. The query cache is persisted, so a fresh copy from before the fix would otherwise keep the
 * notice up and wrongly say the owner console may need an update.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const HOST = 'samwise.example';
const { fetchFacts } = vi.hoisted(() => ({ fetchFacts: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({ getHostIdentity: () => HOST, getRoot: () => `https://${HOST}` }),
}));
vi.mock('@/hooks/auth/useAuth', () => ({ useAuth: () => ({ getIdentity: () => HOST }) }));
vi.mock('@/hooks/useSyncService', () => ({
    useSyncService: () => ({ syncStatus: 'idle', pendingCount: { total: 0 }, lastSyncedAt: null, websocketConnected: true }),
}));
vi.mock('@/hooks/useOnlineContext', () => ({ useOnlineContext: () => ({ isOnline: true }) }));
vi.mock('@/hooks/useDeviceType', () => ({ useDeviceType: () => 'desktop' }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ status: 'off' }) }));
vi.mock('@/hooks/useStorageInfo', () => ({ useStorageInfo: () => ({ usage: null, quota: null }), formatBytes: String }));
vi.mock('@/hooks/auth/useMissingPermissions', () => ({ getJournalDriveFixUrl: () => `https://${HOST}/owner/appupdate` }));
vi.mock('@/lib/db', () => ({
    clearRetryBackoff: vi.fn(),
    getAppState: vi.fn(async () => null),
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
import { SHARE_DRIVE_FIX_ATTEMPT_KEY } from '@/lib/storage';

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
});

describe('useDiagnostics: journal drive facts after the owner console fix (#870)', () => {
    it('re-reads the drive despite a fresh cached copy, and never calls the fix failed meanwhile', async () => {
        // The app-wide default (App.tsx): a 5-minute staleTime over a persisted cache.
        const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000 } } });
        queryClient.setQueryData(['journal-drive-facts', HOST], { attributes: {} });
        localStorage.setItem(SHARE_DRIVE_FIX_ATTEMPT_KEY, HOST);
        let resolve!: (facts: unknown) => void;
        fetchFacts.mockReturnValue(new Promise((r) => (resolve = r)));

        let result!: ReturnType<typeof useDiagnostics>;
        const Probe = () => {
            result = useDiagnostics();
            return null;
        };
        const root = createRoot(document.createElement('div'));
        await act(async () => {
            root.render(h(QueryClientProvider, { client: queryClient }, h(Probe)));
        });

        expect(fetchFacts).toHaveBeenCalledTimes(1);
        expect(result.shareDriveFixFailed).toBe(false);

        resolve({ attributes: { IsCollaborativeChannel: 'true' } });
        await vi.waitFor(async () => {
            await act(async () => new Promise((r) => setTimeout(r, 0)));
            expect(result.shareDriveFixUrl).toBeNull();
        });
        expect(result.shareDriveFixFailed).toBe(false);
        expect(localStorage.getItem(SHARE_DRIVE_FIX_ATTEMPT_KEY)).toBeNull();
        await act(async () => root.unmount());
    });

    it("links the drive's settings under the app that owns it, once the drive is read", async () => {
        const queryClient = new QueryClient();
        fetchFacts.mockResolvedValue({ appId: 'c762ee78-4274-4734-8091-9d8080d7a825', attributes: {} });

        let result!: ReturnType<typeof useDiagnostics>;
        const Probe = () => {
            result = useDiagnostics();
            return null;
        };
        const root = createRoot(document.createElement('div'));
        await act(async () => {
            root.render(h(QueryClientProvider, { client: queryClient }, h(Probe)));
        });

        await vi.waitFor(() =>
            expect(result.driveSettingsUrl).toBe(
                `https://${HOST}/owner/apps/c762ee78-4274-4734-8091-9d8080d7a825/drives/d5f411fa83fd4854a3bd7e974cc9bca9_30743710039d4b97bbd352f343d1c9df`,
            ),
        );
        await act(async () => root.unmount());
    });
});
